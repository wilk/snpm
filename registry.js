const express = require('express'),
  bodyParser = require('body-parser'),
  fetch = require('node-fetch'),
  fs = require('fs'),
  util = require('util'),
  os = require('os'),
  path = require('path'),
  tar = require('targz'),
  npm = require('npm'),
  crypto = require('crypto'),
  decompressAsync = util.promisify(tar.decompress),
  mkdtempAsync = util.promisify(fs.mkdtemp),
  readFileAsync = util.promisify(fs.readFile),
  server = express(),
  port = process.env.REGISTRY_PORT || 3000

const saveArchive = (response, tarFile) => {
  return new Promise(async (resolve, reject) => {
    try {
      const destPath = await mkdtempAsync(path.join(os.tmpdir(), 'snpm-'))

      const destFile = path.resolve(destPath, tarFile)
      const dest = fs.createWriteStream(destFile)
      response.body.pipe(dest)
      response.body.on('error', err => reject(err))
      response.body.on('end', () => resolve({destPath, destFile}))
    } catch (err) {reject(err)}
  })
}

const loadAsync = cfg => {
  return new Promise((resolve, reject) => {
    npm.load(cfg, err => {
      if (err) return reject(err)

      resolve()
    })
  })
}

const installAsync = folder => {
  return new Promise((resolve, reject) => {
    npm.commands.install(folder, [], err => {
      if (err) return reject(err)

      resolve()
    })
  })
}

const runAsync = command => {
  return new Promise((resolve, reject) => {
    npm.commands.run([command], err => {
      if (err) return reject(err)

      resolve()
    })
  })
}

server.use(bodyParser.json())
server.post('/publish', async (req, res) => {
  const {url, version, checksum} = req.body

  if (!url || !url.includes('github.com')) return res.status(400).send('Invalid Github URL')
  if (!version) return res.status(400).send('Invalid version')
  if (!checksum) return res.status(400).send('Invalid checksum')

  // covering /<owner>/<repo> urls
  const splitUrl = url.split('/')

  // covering also git@github.com:<owner>/<repo> urls
  let owner = splitUrl[splitUrl.length - 2]
  const ownerSplit = owner.split(':')
  if (ownerSplit.length > 1 && ownerSplit[1].length > 0) owner = ownerSplit[1]
  const repo = splitUrl[splitUrl.length - 1].replace('.git', '')

  let destPath, destFile
  try {
    console.log('Fetching repo archive...')
    const tarFile = `v${version}.tar.gz`
    const response = await fetch(`https://github.com/${owner}/${repo}/archive/${tarFile}`)
    const archive = await saveArchive(response, tarFile)

    destPath = archive.destPath
    destFile = archive.destFile
  } catch (err) {
    console.error(err)
    return res.status(500).send('Cannot fetch project tar.gz')
  }

  try {
    console.log('Decompressing repo archive...')
    await decompressAsync({src: destFile, dest: destPath})

    process.chdir(path.resolve(destPath, `${repo}-${version}`))
  } catch (err) {
    console.error(err)
    return res.status(500).send('Cannot untar project tar.gz')
  }

  let pkg
  try {
    console.log('Installing repo deps...')
    await loadAsync({
      loglevel: 'silent',
      progress: false
    })

    const results = await Promise.all([
      (async () => {
        const file = await readFileAsync(path.resolve(process.cwd(), 'package.json'))
        return JSON.parse(file)
      })(),
      installAsync(process.cwd())
    ])

    pkg = results[0]
  } catch (err) {
    console.error(err)
    return res.status(500).send('Cannot install project dependencies')
  }

  try {
    console.log('Building repo...')
    await runAsync('build')
  } catch (err) {
    console.error(err)
    return res.status(500).send('Cannot build project')
  }

  try {
    console.log('Checking checksum...')
    const sum = crypto.createHash('sha1')
    const file = await readFileAsync(path.resolve(process.cwd(), pkg.bin))
    sum.update(file)
    if (sum.digest('hex') !== pkg.checksums.sha1) return res.status(400).send('Build SHA1 checksum is different')
  } catch (err) {
    console.error(err)
    return res.status(500).send('Cannot check project checksum')
  }

  console.log('Finished!')
  res.end()
})

server.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
