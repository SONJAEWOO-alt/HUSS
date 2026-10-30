#!/usr/bin/env node
// ===== Railway/프로덕션 통합 시작 스크립트 =====
// 하나의 서비스에서: 프론트엔드 빌드 → MCP 서버(8788) → 백엔드(PORT) 순서로 기동.
// 백엔드는 dist를 정적 서빙하므로 최종적으로 단일 포트로 서비스됨.
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// 1) 프론트엔드 빌드 (dist 없을 때만 - Railway은 첫 빌드 후 캐시)
const distDir = path.join(root, 'dist')
if (!fs.existsSync(distDir)) {
  console.log('[start] 프론트엔드 빌드 시작...')
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true })
  if (build.status !== 0) {
    console.error('[start] 프론트엔드 빌드 실패')
    process.exit(1)
  }
}

// 2) MCP 서버 기동 (별도 프로세스, 백엔드 종료 시 함께 종료)
console.log('[start] MCP 서버 기동...')
const mcp = spawn('node', ['mcp/server.mjs'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env }
})
mcp.on('error', (e) => console.error('[start] MCP 기동 오류:', e.message))

// 3) 백엔드 기동 (PORT는 Railway이 주입)
console.log('[start] 백엔드 기동...')
const server = spawn('node', ['server.mjs'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env }
})

const shutdown = () => {
  mcp.kill()
  server.kill()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

server.on('exit', (code) => {
  console.log(`[start] 백엔드 종료 (code ${code})`)
  mcp.kill()
  process.exit(code ?? 0)
})
