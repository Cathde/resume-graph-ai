# Resume Graph AI

Resume Graph AI 是一个本地优先的简历版本与岗位定制管理工具。它保存原始 DOCX/PDF、记录父子版本关系、识别结构化变化，并使用你自己的 AI API 分析简历与岗位 JD 的匹配情况。

## 主要功能

- 岗位工作台：保存 JD、投递状态、截止时间与下一步行动
- 简历谱系：记录根简历、派生版本和岗位关联
- 本地解析：支持 DOCX 与文本型 PDF；原文件保存在浏览器 IndexedDB
- 结构化差异：区分调序、改写、删除、新增及待确认项
- AI 岗位分析：整体匹配、JD 覆盖、修改有效性与行动建议
- 多服务商：内置 DeepSeek、OpenAI，并支持自定义 OpenAI Chat Completions 兼容接口
- 完整备份：导出和恢复包含原文件的 ZIP 工作区备份

## 隐私与 API Key

- 简历、JD、解析结果和 AI 结果默认只保存在当前浏览器。
- 只有点击“开始 AI 分析”时，必要文本才会发送给所选 AI 服务商。
- API Key 存在当前浏览器的 localStorage 或 sessionStorage 中，不进入工作区备份，也不写入代码。
- 自定义接口必须使用公开可访问的 HTTPS 地址。
- ZIP 备份没有加密，可能包含敏感个人信息，请妥善保存。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
git clone https://github.com/Cathde/resume-graph-ai.git
cd resume-graph-ai
npm install
npm run dev
```

启动后打开终端显示的本地地址。首次使用可先保存岗位 JD，也可以直接上传第一份简历。AI 功能需要在网页右上角的“AI 设置”中填写自己的服务商、API Key 和模型名称。

常用命令：

```bash
npm run dev           # 本地开发
npm run lint          # 代码规范检查
npm test              # 构建并运行逻辑测试
npm run build         # Cloudflare / Sites 构建
npm run build:vercel  # Vercel Nitro 构建
```

## 部署到 Vercel

项目已包含 `vercel.json` 和 Vinext 的 Nitro 适配，构建后会生成 Vercel Build Output API 所需的 `.vercel/output`：

1. 在 Vercel 导入 GitHub 仓库。
2. 保持仓库中的构建配置，无需添加 API Key 环境变量。
3. 每次推送到默认分支后，Vercel 会自动重新部署。

访客需要在自己的浏览器中填写自己的 AI API Key。网站不会共享站点所有者的密钥。

## 支持的 AI 接口

预设：

- DeepSeek：`https://api.deepseek.com/chat/completions`
- OpenAI：`https://api.openai.com/v1/chat/completions`

自定义服务需要兼容 OpenAI Chat Completions 的请求与响应结构，并返回 `choices[0].message.content`。对于自定义接口，网站依靠提示词要求 JSON 输出，不强制发送 `response_format`，以兼容更多服务。

## 已知边界

- 不支持扫描型 PDF 和 OCR。
- 某些 LaTeX PDF 的内嵌字体缺少正确字符映射，可能无法可靠提取文字；优先使用原始 DOCX 或手动粘贴文本。
- AI 结论是基于已有文本的辅助判断，不代表招聘方结论，也不应被用于虚构经历。
- 不同 OpenAI 兼容服务对模型参数的支持可能不同；遇到错误时请核对服务商文档中的模型 ID 和接口地址。

## License

[MIT](./LICENSE)
