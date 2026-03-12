<a id="readme-top"></a>

<div align="center">
  <a href="https://github.com/FloatFu-true/Anyfork">
    <img src="./assets/logo/anyfork-logo.svg" alt="AnyFork Logo" width="280" height="162">
  </a>

  <h3 align="center">AnyFork</h3>

  <p align="center">
    在 Codex、Claude、Gemini 之间 fork 本地 session，并尽量保留目标端原生 resume 体验。
    <br />
    简体中文
    ·
    <a href="./README.md">English</a>
    ·
    <a href="https://github.com/FloatFu-true/Anyfork/issues">反馈问题</a>
    ·
    <a href="https://github.com/FloatFu-true/Anyfork/issues">功能建议</a>
  </p>

  <p align="center">
    <a href="https://www.npmjs.com/package/@floatfu-true/anyfork-cli"><img src="https://img.shields.io/npm/v/@floatfu-true/anyfork-cli?style=for-the-badge" alt="NPM Version"></a>
    <a href="https://github.com/FloatFu-true/Anyfork/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FloatFu-true/Anyfork?style=for-the-badge" alt="MIT License"></a>
    <a href="https://github.com/FloatFu-true/Anyfork/issues"><img src="https://img.shields.io/github/issues/FloatFu-true/Anyfork?style=for-the-badge" alt="Issues"></a>
    <a href="https://www.npmjs.com/package/@floatfu-true/anyfork-cli"><img src="https://img.shields.io/node/v/@floatfu-true/anyfork-cli?style=for-the-badge" alt="Node 22+"></a>
  </p>
</div>

## 目录

- [关于项目](#关于项目)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [使用方式](#使用方式)
- [演示](#演示)
- [路线图](#路线图)
- [参与贡献](#参与贡献)
- [许可证](#许可证)
- [联系](#联系)
- [鸣谢](#鸣谢)

## 关于项目

AnyFork 是一个开源 CLI，只专注做一件事：

把一个 AI 编程 CLI 里的真实本地对话迁移到另一个 AI 编程 CLI，保留可见 transcript，并在目标端格式已知时写入可原生 resume 的本地 session 数据。

这个项目存在的原因很直接。原生 fork 往往只能停留在单一产品内部，但真实工程流程经常是：

1. 先在一个 agent 里积累了大量上下文
2. 发现下一步更适合交给另一个 agent
3. 又不想手工重写整段对话上下文

AnyFork 关注的是可实际落地的连续性：

- 按顺序保留可见 transcript
- 在 `.anyfork/` 下生成可检查的 bridge artifacts
- 在支持的平台上写入目标端原生本地会话数据
- 对外公开命令面刻意保持极小

AnyFork 不试图成为：

- 云端同步平台
- 后端记忆服务
- 厂商私有隐藏缓存的逐字节克隆器
- 各家原生 CLI 的替代品

它追求的是工程工作流里真正可用的跨工具连续性。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 技术栈

- [Node.js](https://nodejs.org/)
- npm workspaces
- Codex、Claude Code、Gemini CLI 的本地 session 存储
- 用于 Codex thread 索引写入的 Node SQLite 支持

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 快速开始

### 前置要求

- `Node.js >= 22`
- 本地已安装源端 CLI
- 本地已安装目标端 CLI

### 安装

安装 CLI 包：

```bash
npm install -g @floatfu-true/anyfork-cli
```

验证安装：

```bash
anyfork --help
```

大多数用户只需要 `@floatfu-true/anyfork-cli`。

`@floatfu-true/anyfork-core` 是给 CLI 和高级集成使用的底层 bridge 库。

### 本地开发

```bash
git clone https://github.com/FloatFu-true/Anyfork.git
cd Anyfork
npm install
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

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

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

一次 fork 的内部流程：

1. 从本地 CLI 存储里定位源 session
2. 规范化并去重可见 transcript
3. 导出 bridge bundle 和可阅读的 handoff 文档
4. 在目标端格式已知时写入目标原生会话数据
5. 如果未使用 `--dry-run`，则通过目标 CLI 自己的 resume 路径启动

桥接产物默认写到：

```text
.anyfork/bridges/<from>-to-<to>-<session>-<timestamp>/
  bundle.json
  handoff.md
```

当前支持的平台：

- `codex`
- `claude`
- `gemini`

当前支持的桥接方向：

- `codex -> claude`
- `codex -> gemini`
- `claude -> codex`
- `claude -> gemini`
- `gemini -> codex`
- `gemini -> claude`

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 演示

### 30 秒宣传视频

- [观看宣传视频](./assets/demo/anyfork-promo-30s.mp4)

### 实际 resume 效果图

#### Claude -> Gemini

![Claude 到 Gemini 的 resume 演示](./assets/screenshots/claude-to-gemini-resume.svg)

#### Gemini -> Codex

![Gemini 到 Codex 的 resume 演示](./assets/screenshots/gemini-to-codex-resume.svg)

#### Gemini -> Claude

![Gemini 到 Claude 的 resume 演示](./assets/screenshots/gemini-to-claude-resume.svg)

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 路线图

- [x] 六个跨 CLI 方向的 session bridge
- [x] Codex、Claude、Gemini 的原生 resume 数据写入
- [x] 以 `fork` 为中心的极简公开 CLI 面
- [x] 中英文双语项目文档
- [ ] 增强厂商 schema 变更时的诊断信息
- [ ] 增加 resume 对齐验证工具
- [ ] 补充贡献与发布流程文档

更多变更建议和问题，见 [Issues](https://github.com/FloatFu-true/Anyfork/issues)。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 参与贡献

开源项目的价值来自真实协作。如果你有能让 AnyFork 更好的想法，欢迎先提 issue，也欢迎直接发起 PR。

1. Fork 本项目
2. 创建功能分支：`git checkout -b feature/amazing-feature`
3. 提交改动：`git commit -m "feat: add amazing feature"`
4. 推送分支：`git push origin feature/amazing-feature`
5. 发起 Pull Request

也欢迎帮忙一起守住 AnyFork 的产品边界，让公开命令面继续保持专注，不轻易膨胀。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 许可证

本项目基于 MIT License 发布。详情见 [LICENSE](./LICENSE)。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 联系

- GitHub 组织：[@FloatFu-true](https://github.com/FloatFu-true)
- 项目仓库：[https://github.com/FloatFu-true/Anyfork](https://github.com/FloatFu-true/Anyfork)
- npm 包：[@floatfu-true/anyfork-cli](https://www.npmjs.com/package/@floatfu-true/anyfork-cli)

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>

## 鸣谢

- [othneildrew/Best-README-Template](https://github.com/othneildrew/Best-README-Template)，README 结构灵感来源
- [Choose an Open Source License](https://choosealicense.com/)
- [Shields.io](https://shields.io/)

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>
