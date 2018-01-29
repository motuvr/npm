'use strict'
const fs = require('graceful-fs')
const Bluebird = require('bluebird')
const audit = require('./install/audit.js')
const npm = require('./npm.js')

const readFile = Bluebird.promisify(fs.readFile)

module.exports = auditCmd

auditCmd.usage =
  'npm audit\n'

auditCmd.completion = function (opts, cb) {
  const argv = opts.conf.argv.remain

  switch (argv[2]) {
    case 'audit':
      return cb(null, [])
    default:
      return cb(new Error(argv[2] + ' not recognized'))
  }
}

function maybeReadFile (name) {
  return readFile(`${npm.prefix}/${name}`)
    .then((data) => JSON.parse(data))
    .catch({code: 'ENOENT'}, () => null)
}

function auditCmd (args, cb) {
  return Bluebird.all([
// TODO: Warn on both
// TODO: Error on neither
    maybeReadFile('npm-shrinkwrap.json'),
    maybeReadFile('package-lock.json'),
// TODO: Error on missing
    maybeReadFile('package.json')
  ]).spread((shrinkwrap, lockfile, pkgJson) => {
    const sw = shrinkwrap || lockfile
    const requires = Object.assign(
      {},
      (pkgJson && pkgJson.dependencies) || {},
      (pkgJson && pkgJson.devDependencies) || {}
    )
    return audit.generate(sw, requires)
  }).then((auditReport) => {
    return audit.submit(auditReport)
  }).then((auditResult) => {
    return audit.printFullReport(auditResult)
  }).asCallback(cb)
}
