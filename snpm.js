const fetch = require('node-fetch'),
  fs = require('fs'),
  path = require('path'),
  util = require('util'),
  io = require('socket.io-client'),
  readFileAsync = util.promisify(fs.readFile),
  REGISTRY_API = process.env.REGISTRY_URL || 'http://localhost',
  REGISTRY_PORT = parseInt(process.env.REGISTRY_PORT) || parseInt(3000),
  socket = io.connect(`${REGISTRY_API}:${REGISTRY_PORT}`)

socket.on('connect', async () => {
  socket.on('error', err => console.error(err))
  socket.on('message', message => console.log(`registry > ${message}`))

  const pkgJsonPath = path.resolve(process.argv[2], 'package.json')

  let pkg
  try {
    console.log('snpm > Reading project package.json...')
    const raw = await readFileAsync(pkgJsonPath)
    pkg = JSON.parse(raw)
  } catch (err) {
    console.log(`snpm > Cannot read package.json from ${pkgJsonPath}`)
    console.error(err)

    process.exit(1)
  }

  console.log('snpm > Publishing package...')
  socket.emit('publish', {url: pkg.repository.url, version: pkg.version})
})