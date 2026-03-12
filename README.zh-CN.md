# AnyFork

简体中文 | [English](./README.md)

AnyFork 是一个开源 CLI，只专注做一件事：

把一个 AI 编程 CLI 里的本地 session fork 到另一个 AI 编程 CLI，同时尽量保留可见对话内容，并在目标端格式已知时写入可原生 `/resume` 的本地会话数据。

它是一个刻意保持小而专注的本地工具，并且和 MineMemory 完全独立。

## 演示效果

AnyFork 关注的是“真实可恢复的 resume 流程”，而不是只导出一份抽象 transcript。

### Claude -> Gemini

![Claude 到 Gemini 的 resume 演示](./assets/screenshots/claude-to-gemini-resume.svg)

### Gemini -> Codex

![Gemini 到 Codex 的 resume 演示](./assets/screenshots/gemini-to-codex-resume.svg)

### Gemini -> Claude

![Gemini 到 Claude 的 resume 演示](./assets/screenshots/gemini-to-claude-resume.svg)

## 为什么做这个项目

原生 fork 往往只能停留在单一产品内部。

但真实工作流通常是这样的：

1. 先在一个 agent 里积累了大量上下文
2. 发现下一步更适合交给另一个 agent
3. 又不想重新手工总结和复制整段上下文

AnyFork 的目标就是去掉这层切换成本。它会读取真实本地 session，导出桥接 bundle，并在目标 CLI 的本地格式可识别时写回目标端的原生 session 数据。

## AnyFork 会做什么

- 在 `codex`、`claude`、`gemini` 之间 fork session
- 按顺序保留可见 transcript
- 在 `.anyfork/` 下生成可检查的 bridge artifacts
- 在支持的平台上写入目标端可 resume 的本地会话数据
- 对外公开命令面尽量保持极小

## AnyFork 不做什么

- 不承诺逐字节克隆厂商私有隐藏缓存
- 不依赖云端后端服务
- 不是记忆平台，也不是同步服务
- 不试图取代各家原生 CLI

它追求的是“足够真实、足够可继续”的跨工具连续性，而不是厂商私有内部缓存的镜像复制。

## 安装

要求：

- `Node.js >= 22`
- 本地已经安装源端 CLI
- 本地已经安装目标端 CLI

普通用户安装这个包就够了：

```bash
npm install -g @floatfu-true/anyfork-cli
```

验证安装：

```bash
anyfork --help
```

大多数用户只需要 `@floatfu-true/anyfork-cli`。

`@floatfu-true/anyfork-core` 主要给程序化集成和内部复用使用。

## 使用方式

如果不带子命令，AnyFork 会显示主帮助信息。

```text
Usage: anyfork [OPTIONS]
       anyfork fork <FROM> <TO> <SESSION|last> [OPTIONS]

Commands:
  fork           Fork a source session from one CLI into another CLI
  help           Print this message or the help of the given subcommand(s)
```

核心命令：

```bash
anyfork fork <from> <to> <session|last>
```

示例：

```bash
anyfork fork codex claude last
anyfork fork claude codex 20486cab-8ead-4410-b2d2-8bb6e66ae804
anyfork fork gemini claude 3c5c4e92-b356-483b-ab96-7d14321e7f0c
anyfork fork codex gemini last --prompt "Continue implementation"
```

## 工作原理

1. 从本地 CLI 存储里定位源 session。
2. 规范化并去重可见 transcript。
3. 导出 bridge bundle 和可阅读的 handoff 文档。
4. 在目标端格式已知时写入目标原生会话数据。
5. 如果没有使用 `--dry-run`，则通过目标 CLI 自己的 resume 路径启动。

桥接产物默认写到：

```text
.anyfork/bridges/<from>-to-<to>-<session>-<timestamp>/
  bundle.json
  handoff.md
```

## 当前支持的 CLI

平台：

- `codex`
- `claude`
- `gemini`

当前桥接方向：

- `codex -> claude`
- `codex -> gemini`
- `claude -> codex`
- `claude -> gemini`
- `gemini -> codex`
- `gemini -> claude`

## 仓库结构

```text
assets/
  screenshots/
packages/
  cli/
  core/
tests/
README.md
README.zh-CN.md
LICENSE
```

## 包结构说明

- `@floatfu-true/anyfork-cli`
  面向普通用户的 CLI 包
- `@floatfu-true/anyfork-core`
  给 CLI 和高级集成复用的底层 bridge 库

## 开发

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

本地运行 CLI：

```bash
node packages/cli/src/index.js --help
node packages/cli/src/index.js fork codex claude last --dry-run
```

发布前做 dry-run 打包检查：

```bash
npm run pack:core
npm run pack:cli
```

## 安全与发布卫生

在公开发布或推到 GitHub 前，建议确认：

- 测试已经通过
- tarball 里只包含预期源码文件
- `.anyfork/`、日志、调试输出和本地桥接产物没有被追踪
- 没有 token、密钥或私有环境文件被提交

## 当前限制

- 兼容性依赖各家 CLI 暴露出来的本地存储格式
- 如果厂商修改了本地 session schema，AnyFork 可能需要同步更新
- 某些 CLI 是项目目录敏感的，因此启动目录会影响 resume 可见性
- 最终 `/resume` picker 的展示方式仍由目标 CLI 自己控制

## 许可证

MIT
