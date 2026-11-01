import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { compareTrees, hashTree, isIdentical } from '../web-variant/dist-compare.mjs'

/**
 * Build a directory holding the given files.
 * @param {Record<string, string>} files - Relative path -> content.
 * @returns {string} The directory.
 */
function treeOf(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-dist-compare-'))
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(dir, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
  return dir
}

test('compareTrees：两个同样的目录逐字节一致', () => {
  const left = treeOf({ 'index.html': '<html>', 'assets/app.js': 'console.log(1)' })
  const right = treeOf({ 'index.html': '<html>', 'assets/app.js': 'console.log(1)' })
  try {
    const difference = compareTrees(left, right)
    assert.equal(isIdentical(difference), true)
    assert.deepEqual(difference.onlyLeft, [])
    assert.deepEqual(difference.onlyRight, [])
    assert.deepEqual(difference.changed, [])
    assert.equal(hashTree(left).size, 2)
  } finally {
    rmSync(left, { recursive: true, force: true })
    rmSync(right, { recursive: true, force: true })
  }
})

test('compareTrees：内容变了算 changed', () => {
  const left = treeOf({ 'index.html': '<html>' })
  const right = treeOf({ 'index.html': '<html><body>' })
  try {
    const difference = compareTrees(left, right)
    assert.equal(isIdentical(difference), false)
    assert.deepEqual(difference.changed, ['index.html'])
    assert.equal(difference.contentOnlyLeft.length, 1)
    assert.equal(difference.contentOnlyRight.length, 1)
  } finally {
    rmSync(left, { recursive: true, force: true })
    rmSync(right, { recursive: true, force: true })
  }
})

test('compareTrees：只改名不算内容变化', () => {
  const left = treeOf({ 'assets/app-old.js': 'console.log(1)' })
  const right = treeOf({ 'assets/app-new.js': 'console.log(1)' })
  try {
    const difference = compareTrees(left, right)
    assert.equal(isIdentical(difference), false)
    assert.deepEqual(difference.onlyLeft, ['assets/app-old.js'])
    assert.deepEqual(difference.onlyRight, ['assets/app-new.js'])
    // 文件名变了，字节没变：内容差异为空。
    assert.deepEqual(difference.contentOnlyLeft, [])
    assert.deepEqual(difference.contentOnlyRight, [])
  } finally {
    rmSync(left, { recursive: true, force: true })
    rmSync(right, { recursive: true, force: true })
  }
})

test('compareTrees：多出来的文件算 onlyRight', () => {
  const left = treeOf({ 'index.html': '<html>' })
  const right = treeOf({ 'index.html': '<html>', 'extra.js': 'x' })
  try {
    const difference = compareTrees(left, right)
    assert.equal(isIdentical(difference), false)
    assert.deepEqual(difference.onlyLeft, [])
    assert.deepEqual(difference.onlyRight, ['extra.js'])
  } finally {
    rmSync(left, { recursive: true, force: true })
    rmSync(right, { recursive: true, force: true })
  }
})
