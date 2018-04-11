'use strict'
exports.generate = generate
exports.generateFromInstall = generateFromInstall
exports.submitForInstallReport = submitForInstallReport
exports.submitForFullReport = submitForFullReport
exports.printInstallReport = printInstallReport
exports.printFullReport = printFullReport

const Bluebird = require('bluebird')
const fs = require('graceful-fs')
const readFile = Bluebird.promisify(fs.readFile)
const auditReport = require('npm-audit-report')
const treeToShrinkwrap = require('../shrinkwrap.js').treeToShrinkwrap
const packageId = require('../utils/package-id.js')
const output = require('../utils/output.js')
const npm = require('../npm.js')
const path = require('path')
const spawn = require('child_process').spawn
const qw = require('qw')
const registryFetch = require('npm-registry-fetch')
const fetch = require('make-fetch-happen')
const zlib = require('zlib')
const gzip = Bluebird.promisify(zlib.gzip)

function submitForInstallReport (auditData) {
  // TODO: registryFetch will be adding native support for `Content-Encoding: gzip` at which point
  // we'll pass in something like `gzip: true` and not need to JSON stringify, gzip or headers.
  return gzip(JSON.stringify(auditData)).then(body => {
    // TODO: this needs to be changed to submit to ALL configured registry URLs but only
    // return the response from the the primary one
    return registryFetch.json('http://registry.npm.red/-/npm/v1/security/audits/quick', {
      method: 'POST',
      headers: { 'Content-Encoding': 'gzip', 'Content-Type': 'application/json' },
      body: body
    })
  })
}

function submitForFullReport (auditData) {
  // TODO: registryFetch will be adding native support for `Content-Encoding: gzip` at which point
  // we'll pass in something like `gzip: true` and not need to JSON stringify, gzip or headers.
  return gzip(JSON.stringify(auditData)).then(body => {
    // TODO: this needs to be changed to submit to ALL configured registry URLs but only
    // return the response from the the primary one
    return registryFetch.json('http://registry.npm.red/-/npm/v1/security/audits', {
      method: 'POST',
      headers: { 'Content-Encoding': 'gzip', 'Content-Type': 'application/json' },
      body: body
    })
  })
}

function printInstallReport (auditResult) {
  return auditReport(auditResult, {
    reporter: 'install',
    withColor: npm.color,
    withUnicode: npm.config.get('unicode')
  }).then(result => output(result.report))
}

function printFullReport (auditResult) {
  return auditReport(auditResult, {
    log: output,
    reporter: 'detail',
    withColor: npm.color,
    withUnicode: npm.config.get('unicode')
  }).then(result => output(result.report))
}

function generate (shrinkwrap, requires, diffs, install, remove) {
  const sw = Object.assign({}, shrinkwrap)
  delete sw.lockfileVersion
//  sw.auditReportVersion = '1.0'
  sw.requires = requires


  sw.diffs = diffs || {}
  sw.install = install || []
  sw.remove = remove || []

  return generateMetadata().then((md) => {
    sw.metadata = md
    return sw
  })
}

function generateMetadata() {
  const meta = {}
  meta.npm_version = npm.version
  meta.node_version = process.version
  meta.platform = process.platform
  meta.node_env = process.env.NODE_ENV

// TODO strip auth data from git: modules, paths from file:, resolved
// maybe more: top level name/version

  const head = path.resolve(npm.prefix, '.git/HEAD')
  return readFile(head, 'utf8').then((head) => {
    if (!head.match(/^ref: /)) {
      meta.commit_hash = head.trim()
      return
    }
    const headFile = head.replace(/^ref: /, '').trim()
    meta.branch = headFile.replace(/^refs[/]heads[/]/, '')
    return readFile(path.resolve(npm.prefix, '.git', headFile), 'utf8')
  }).then((commitHash) => {
    meta.commit_hash = commitHash.trim()
    const proc = spawn('git', qw`diff --quiet --exit-code package.json package-lock.json`, {cwd: npm.prefix, stdio: 'ignore'})
    return new Promise((resolve) => {
      proc.once('error', reject)
      proc.on('exit', (code, signal) => {
        if (signal == null) meta.state = code === 0 ? 'clean' : 'dirty'
        resolve()
      })
    })
  }).then(() => meta, () => meta)
}

function generateFromInstall (tree, diffs, install, remove) {
  const requires = {}
  tree.requires.forEach((pkg) => {
    requires[pkg.package.name] = tree.package.dependencies[pkg.package.name] || tree.package.devDependencies[pkg.package.name] || pkg.package.version
  })

  const auditInstall = (install || []).filter((a) => a.name).map(packageId)
  const auditRemove = (remove || []).filter((a) => a.name).map(packageId)
  const auditDiffs = {}
  diffs.forEach((action) => {
    const mutation = action[0]
    const child = action[1]
    if (mutation !== 'add' && mutation !== 'update' && mutation !== 'remove') return
    if (!auditDiffs[mutation]) auditDiffs[mutation] = []
    if (mutation === 'add') {
      auditDiffs[mutation].push({location: child.location})
    } else if (mutation === 'update') {
      auditDiffs[mutation].push({location: child.location, previous: packageId(child.oldPkg)})
    } else if (mutation === 'remove') {
      auditDiffs[mutation].push({previous: packageId(child)})
    }
  })

  return generate(treeToShrinkwrap(tree), requires, auditDiffs, auditInstall, auditRemove)
}
