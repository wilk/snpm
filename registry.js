const express = require('express'),
  fetch = require('node-fetch'),
  fs = require('fs'),
  util = require('util'),
  os = require('os'),
  path = require('path'),
  tar = require('targz'),
  npm = require('npm'),
  crypto = require('crypto'),
  server = express(),
  http = require('http').Server(server),
  io = require('socket.io')(http)
  decompressAsync = util.promisify(tar.decompress),
  mkdtempAsync = util.promisify(fs.mkdtemp),
  readFileAsync = util.promisify(fs.readFile),
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

const closeConnection = (socket, error) => {
  socket.emit('error', error)
  socket.disconnect(true)
}

const notifyMessage = (socket, message) => {
  console.log(message)
  socket.emit('message', message)
}

io.on('connection', socket => {
  console.log('Incoming connection...')

  socket.on('publish', async payload => {
    const {url, version} = payload

    if (!url || !url.includes('github.com')) return closeConnection(socket, 'Invalid Github URL')
    if (!version) return closeConnection(socket, 'Invalid version')

    // covering /<owner>/<repo> urls
    const splitUrl = url.split('/')

    // covering also git@github.com:<owner>/<repo> urls
    let owner = splitUrl[splitUrl.length - 2]
    const ownerSplit = owner.split(':')
    if (ownerSplit.length > 1 && ownerSplit[1].length > 0) owner = ownerSplit[1]
    const repo = splitUrl[splitUrl.length - 1].replace('.git', '')

    let destPath, destFile
    try {
      notifyMessage(socket, 'Fetching repo archive...')
      const tarFile = `v${version}.tar.gz`
      const response = await fetch(`https://github.com/${owner}/${repo}/archive/${tarFile}`)
      const archive = await saveArchive(response, tarFile)

      destPath = archive.destPath
      destFile = archive.destFile
    } catch (err) {
      console.error(err)
      return closeConnection(socket, 'Cannot fetch project tar.gz')
    }

    try {
      notifyMessage(socket, 'Decompressing repo archive...')
      await decompressAsync({src: destFile, dest: destPath})

      process.chdir(path.resolve(destPath, `${repo}-${version}`))
    } catch (err) {
      console.error(err)
      return closeConnection(socket, 'Cannot untar project tar.gz')
    }

    let pkg
    try {
      notifyMessage(socket, 'Installing repo deps...')
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
      return closeConnection(socket, 'Cannot install project dependencies')
    }

    try {
      notifyMessage(socket, 'Building repo...')
      await runAsync('build')
    } catch (err) {
      console.error(err)
      return closeConnection(socket, 'Cannot build project')
    }

    try {
      notifyMessage(socket, 'Checking checksum...')
      const sum = crypto.createHash('sha1')
      const file = await readFileAsync(path.resolve(process.cwd(), pkg.bin))
      sum.update(file)
      if (sum.digest('hex') !== pkg.checksums.sha1) return closeConnection(socket, 'Build SHA1 checksum is different')
    } catch (err) {
      console.error(err)
      return closeConnection(socket, 'Cannot check project checksum')
    }

    notifyMessage(socket, 'Package published successfully!')
    socket.disconnect(true)
  })
})

http.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
