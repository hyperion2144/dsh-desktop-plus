import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageDesktopPlugins } from '../src/plugin-staging.ts'

const NAME = '@deepseek-ai/dsh-desktop-plus-plugin'

async function withProfile(run: (profileDir: string, pluginDir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'plus-staging-'))
  const pluginDir = join(dir, 'plugin-source')
  try {
    await mkdir(pluginDir, { recursive: true })
    await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ name: NAME, version: '0.1.0' }))
    await run(join(dir, 'profile'), pluginDir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('stageDesktopPlugins', () => {
  it('links the package into the profile node_modules', async () => {
    await withProfile(async (profileDir, pluginDir) => {
      const result = stageDesktopPlugins({ profileDir, plugins: [{ name: NAME, dir: pluginDir }] })
      expect(result.staged).toHaveLength(1)
      expect(result.already).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
      const link = join(profileDir, 'node_modules', NAME)
      await expect(readlink(link)).resolves.toBe(pluginDir)
    })
  })

  it('is idempotent: a second run reports the link as already staged', async () => {
    await withProfile(async (profileDir, pluginDir) => {
      stageDesktopPlugins({ profileDir, plugins: [{ name: NAME, dir: pluginDir }] })
      const again = stageDesktopPlugins({ profileDir, plugins: [{ name: NAME, dir: pluginDir }] })
      expect(again.staged).toHaveLength(0)
      expect(again.already).toEqual([NAME])
    })
  })

  it('repairs a link that is missing', async () => {
    await withProfile(async (profileDir, pluginDir) => {
      stageDesktopPlugins({ profileDir, plugins: [{ name: NAME, dir: pluginDir }] })
      const link = join(profileDir, 'node_modules', NAME)
      await rm(link, { recursive: true, force: true })
      const repaired = stageDesktopPlugins({ profileDir, plugins: [{ name: NAME, dir: pluginDir }] })
      expect(repaired.staged).toHaveLength(1)
      await expect(readlink(link)).resolves.toBe(pluginDir)
    })
  })

  it('reports a missing package directory instead of throwing', async () => {
    await withProfile(async (profileDir) => {
      const result = stageDesktopPlugins({ profileDir, plugins: [{ name: NAME, dir: '/nonexistent/plus-plugin' }] })
      expect(result.staged).toHaveLength(0)
      expect(result.failed[0]?.name).toBe(NAME)
    })
  })

  it('keeps staging the rest when one package fails', async () => {
    await withProfile(async (profileDir, pluginDir) => {
      const result = stageDesktopPlugins({
        profileDir,
        plugins: [
          { name: NAME, dir: '/nonexistent/plus-plugin' },
          { name: '@deepseek-ai/dsh-desktop-plus-mobile-access', dir: pluginDir },
        ],
      })
      expect(result.staged).toHaveLength(1)
      expect(result.failed).toHaveLength(1)
    })
  })

  it('registers the plugin in the profile manifest as a linked dependency and bundle', async () => {
    await withProfile(async (profileDir, pluginDir) => {
      const result = stageDesktopPlugins({ profileDir, plugins: [{ name: NAME, dir: pluginDir }] })
      expect(result.manifest).toBe(true)
      const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
        dsh: { profile: { bundles: string[] } }
      }
      expect(manifest.dependencies[NAME]).toBe(`link:${pluginDir}`)
      expect(manifest.dsh.profile.bundles).toContain(NAME)
    })
  })

  it('leaves the manifest untouched when it already lists the plugin', async () => {
    await withProfile(async (profileDir, pluginDir) => {
      stageDesktopPlugins({ profileDir, plugins: [{ name: NAME, dir: pluginDir }] })
      const again = stageDesktopPlugins({ profileDir, plugins: [{ name: NAME, dir: pluginDir }] })
      expect(again.manifest).toBe(false)
    })
  })
})
