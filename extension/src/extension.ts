import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

/**
 * 插件激活时的入口函数
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('AI Code Tracker is now active')

  // 初始化钩子注入
  initializeHooks(context)

  // 注册显示看板的命令
  let dashboardDisposable = vscode.commands.registerCommand(
    'ai-code-tracker.showDashboard',
    () => {
      showDashboard(context)
    }
  )

  context.subscriptions.push(dashboardDisposable)
}

/**
 * 初始化 Cursor 钩子，注入 beforeSubmitPrompt 和 stop 钩子到 ~/.cursor/hooks.json
 */
function initializeHooks(context: vscode.ExtensionContext) {
  const homeDir = os.homedir()
  const cursorDir = path.join(homeDir, '.cursor')
  const hooksPath = path.join(cursorDir, 'hooks.json')

  const beforeSubmitPromptPath = path.join(
    context.extensionPath,
    'scripts',
    'beforeSubmitPrompt.js'
  )
  const stopScriptPath = path.join(context.extensionPath, 'scripts', 'stop.js')

  const beforeSubmitPromptCmd = `node "${beforeSubmitPromptPath}"`
  const stopCmd = `node "${stopScriptPath}"`

  try {
    if (!fs.existsSync(cursorDir)) {
      fs.mkdirSync(cursorDir, {recursive: true})
    }

    let config: any = {}
    if (fs.existsSync(hooksPath)) {
      let content = fs.readFileSync(hooksPath, 'utf8')

      // 移除 UTF-8 BOM 字符
      if (content.charCodeAt(0) === 0xfeff) {
        content = content.slice(1)
      }

      try {
        config = JSON.parse(content.trim())
      } catch (e) {
        console.error('AI Code Tracker: Failed to parse hooks.json:', e)
        config = {}
      }
    }

    // 确保 hooks 字段存在
    if (!config.hooks) {
      config.hooks = {}
    }

    let needsUpdate = false

    // 注入 beforeSubmitPrompt 钩子
    if (!Array.isArray(config.hooks.beforeSubmitPrompt)) {
      config.hooks.beforeSubmitPrompt = config.hooks.beforeSubmitPrompt
        ? [{command: config.hooks.beforeSubmitPrompt}]
        : []
    }

    const hasBeforeSubmitPrompt = config.hooks.beforeSubmitPrompt.some(
      (h: any) => h.command?.includes(beforeSubmitPromptCmd)
    )

    if (!hasBeforeSubmitPrompt) {
      config.hooks.beforeSubmitPrompt.push({command: beforeSubmitPromptCmd})
      needsUpdate = true
    }

    // 注入 stop 钩子
    if (!Array.isArray(config.hooks.stop)) {
      config.hooks.stop = config.hooks.stop
        ? [{command: config.hooks.stop}]
        : []
    }

    const hasStop = config.hooks.stop.some((h: any) =>
      h.command?.includes(stopCmd)
    )

    if (!hasStop) {
      config.hooks.stop.push({command: stopCmd})
      needsUpdate = true
    }

    if (needsUpdate) {
      fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2))
      vscode.window.showInformationMessage(
        'AI Code Tracker: Hooks initialized successfully.'
      )
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `AI Code Tracker: Failed to initialize hooks: ${error}`
    )
  }
}

/**
 * 显示效能看板 Webview
 */
function showDashboard(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'aiStatsDashboard',
    'AI Code Stats Dashboard',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'media')),
      ],
    }
  )

  panel.webview.html = getWebviewContent(panel.webview, context.extensionUri)
}

/**
 * 获取 Webview 的 HTML 内容
 */
function getWebviewContent(panel: vscode.Webview, extensionUri: vscode.Uri) {
  const styleUri = panel.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'main.css')
  )

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AI Code Stats</title>
        <link href="${styleUri}" rel="stylesheet">
    </head>
    <body>
        <h1>AI Code Tracker Dashboard</h1>
        <div class="card">
            <div class="stat-item">
                <strong>Status:</strong> <span style="color: #4caf50;">Active</span>
            </div>
            <div class="stat-item">
                <strong>Hooks:</strong> Injected into ~/.cursor/hooks.json
            </div>
            <div class="stat-item">
                <p>Your AI-generated code is being tracked. Visit the web portal for detailed reports.</p>
            </div>
        </div>
        <button onclick="vscode.postMessage({command: 'refresh'})" style="padding: 8px 16px; cursor: pointer;">Refresh Stats</button>
    </body>
    </html>`
}

export function deactivate() {}
