# snpm
Secure NPM Proof of Concept

This is an attempt to make NPM secure when a package is shipped with compiled Javascript.

## The algorithm
A NPM package containing compiled Javascript (so called binaries) MUST have the following info inside the `package.json`:

- a property called [bin](https://docs.npmjs.com/files/package.json#bin) containing the binary file path
- a property called [checksums](http://wiki.commonjs.org/wiki/Packages/1.1) containing the checksum (SHA1) of the binary file
- a property called [repository](https://docs.npmjs.com/files/package.json#repository) containing the repo url (**only Github urls allowed, for now**)
- a property called [version](https://docs.npmjs.com/files/package.json#version) containing the current version of the package
- a script called [build](https://docs.npmjs.com/files/package.json#scripts) with the command to compile the source code

An example of valid package.json:

```javascript
{
  "version": "1.7.2",
  "checksums": {
    "md5": "c0488e3e4c5f6deaac26b80f4974f7ba",
    "sha1": "f7894b95b2f7f4c61582b54c0c9465719952684e"
  },
  "scripts": {
    "build": "babel index.js --out-file dist.js"
  },
  "bin": "dist.js",
  "repository": {
    "type": "git",
    "url": "https://github.com/wilk/thanc"
  }
}
```

Now, follows the rules of the above info:

- `bin` property MUST be a path to a file
- `version` property MUST exist because it will be used to download the tar.gz of the repo
- `repository` property MUST exist because it will be used in conjunction with `version` for the same purpose
- `checksums` property MUST contain the SHA1 hash of the `bin` file
- `build` script MUST be used locally with the devDependencies (or even with dependencies)

Steps from you as the package owner:

 - build the package
 - generate build hashes inside package.json
 - publish with snpm

Steps from snpm:
 - snpm receives just the repo url (Github)
 - snpm downloads the repo from repo url
 - snpm installs every deps
 - snpm runs build steps (snpm run build)
 - snpm generates build hashes
 - snpm checks build hashes with those inside the package.json
 - snpm registers the build if they're ok, otherwise it returns a 400

### SNPM usage

#### Publish
It reads from package.json and sends the following info to the registry:

 - repository url
 - version
 - checksums

```bash
$ snpm publish
```
Follows the list of action taken from `snpm`:
 
 - download version tarball from Github -> fetch -> https://www.npmjs.com/package/targz V
 - install deps with `npm i` -> npm
 - build with `npm run build` -> npm.commands.run ??? V
 - hash sum of dist files -> https://www.npmjs.com/package/sha1-file || https://www.npmjs.com/package/hash-files V without a lib
 - verify hashes -> string check
 
Test:
 - check if npm.commands.run exists
 - test npm targz
 - test sha1file