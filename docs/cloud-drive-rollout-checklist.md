# yourz.top 云盘与操作留痕：上线前检查清单

本功能目前只在 `test/cloud-drive-audit-v1` 分支中开发。不要直接合并到 `main` 或执行正式部署，直到完成下面的 R2 配置和人工验收。

## 当前功能

- 无登录页面；首次访问建立匿名浏览器访客 ID 和共享编辑会话。
- 记录 IP、Cloudflare 提供的 IP 粗略地区、User-Agent、浏览器与操作系统；可由用户填写设备备注。它不是经验证的物理电脑标识。
- 记录工厂页面/资料查看、工厂查询、工厂增删改、云盘列表、文件上传/下载/预览/替换、版本恢复、回收站恢复/删除、设备备注修改。
- 通过 R2 保存原文件；D1 保存文件索引、版本元数据、匿名访客和审计日志。
- 单文件上传目前限制 25 MB；支持 DOC、DOCX、XLS、XLSX、PPT、PPTX、PDF、CSV、TXT 和常见图片。云盘列表采用分页。
- PDF/常见图片由网站直接预览；Office 预览用 Microsoft Office Online Viewer 的短期链接。

## 独立预览环境

测试分支新增了专用工作流：`.github/workflows/deploy-preview-cloudflare.yml`。它只允许从 `test/cloud-drive-audit-v1` 分支触发，目标资源固定为：

- Pages 项目：`yourz-website-preview`（不绑定自定义域名、不修改 DNS）
- D1 数据库：`yourz-factory-preview-db`（独立测试库，不复用 `yourz-factory-db`）
- R2 存储桶：`yourz-documents-preview`（专用测试桶，保持私有，绑定名为 `FILES`）

工作流在创建/部署任何测试资源前，会先检查 Cloudflare API Token、账号 ID、目标 R2 桶和源程序测试。账号 ID 会与当前所有者确认的账号 `34d2541399a1d8cb1f494bd510de6150` 比对；不匹配时会停止。工作流不会创建/修改自定义域名、DNS 记录或生产资源。

### 首次预览部署需要的 GitHub Actions secrets

在 GitHub 仓库「Settings → Secrets and variables → Actions → New repository secret」中添加两个**仅供测试站使用**的密钥：

| Name | Value 要求 |
|---|---|
| `PREVIEW_BOOTSTRAP_ADMIN_PASSWORD` | 单独的强密码，至少 16 个字符；不要复用生产站管理员密码 |

预览管理员用户名固定为 `yourz-preview-admin`，无需另设用户名密钥。预览部署保留原有登录页面；工作流不会应用关闭登录验证的 public-entry 补丁。

不要把密码填入代码、issue 或聊天。现有的 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 也必须配置在 Actions secrets 中；Token 需要能验证账号，并有创建 Pages 项目、创建/读取 D1、查看和绑定 R2 的相应账号级权限。若权限不足，工作流会报告错误并停止；不要把 Token 发给任何人。

工作流目前设置为仅手动触发，以便先验证登录流程和测试资源隔离，再执行首次云端部署。

预览站会使用 Cloudflare 提供的 `pages.dev` 地址，登录页面可从公网访问。预览验收阶段只使用无敏感信息的虚拟样本，不要上传真实报价、合同或个人信息。Cloudflare R2/D1/Pages 虽有免费额度或免费层，超额度仍可能收费。

## 上线前必须完成

1. 已创建私有 R2 bucket：`yourz-documents-preview`。正式环境以后必须另行设置独立 bucket。
2. 完成首次专用预览部署，确认独立 D1 与 R2 绑定生效，且预览页面不指向生产资源。
3. 用真实但不敏感的 DOCX、XLSX、PPTX、PDF 测试中文文件名、Office Viewer、下载、版本恢复与回收站。
4. 核对访问/操作日志。当前有日志写入能力，但日志查看页的开放范围按需求暂缓，之后再由项目所有者确定。
5. 核对备份策略、日志保留期和访问留痕告知。访客 ID 依赖浏览器 Cookie；删除 Cookie、换浏览器或使用 VPN 都会影响设备关联；IP 地区为估算而非 GPS。

## 部署安全警告

现有 `.github/workflows/deploy-cloudflare.yml` 是正式部署流程：它使用项目名 `yourz-website`、生产数据库 `yourz-factory-db`，并处理正式域名 `yourz.top`。**不要用它来测试预览，也不要直接合并本 PR**；合并后可能触发正式环境发布。专用预览流程与正式部署流程分开维护。

## 免费额度与停止条件

R2 当前免费额度包括每月 10 GB-month Standard 存储、100 万次 Class A 操作和 1,000 万次 Class B 操作；没有互联网出口流量费。超额后 Standard 存储 $0.015/GB-month，Class A $4.50/百万次，Class B $0.36/百万次。以一万份、每份平均 5 MB（约 50 GB）为例，仅存储超出免费部分 40 GB，估算约 $0.60/月；请求超额、其他资源与税费另计。请查看最新价目：https://developers.cloudflare.com/r2/pricing/

未经项目所有者确认，不自动购买服务器、不切换付费预览 API、不做付费升级。一旦发现需要持续付费的预览服务器，先暂停并报告。

## 第三方 Office 预览的隐私边界

Microsoft Office Online Viewer 需要从源 URL 获取原文件。当前设计生成随机、只读、15 分钟有效的 URL，原 R2 bucket 仍保持私有，但在有效期内任何拿到该 URL 的人/预览服务都可以获取对应文件。Microsoft 的文档说明 Online Viewers 无法打开需要认证的源文件：https://learn.microsoft.com/en-us/officeonlineserver/office-online-server-overview

因此不要将机密合同、敏感个人信息或不允许交给第三方处理的报价文件使用 Office 在线预览。当前页面会对此作出提示。PDF 预览使用网站自己的下载/读取接口。

## 验收状态

- Test-branch static checks: passed
- Existing Worker/D1 simulation: passed
- Mocked R2 upload/list, temporary Office source token, replace/version restore, trash restore and audit event assertions: passed
- Dedicated preview workflow: added to test branch; not triggered by workflow/docs-only changes
- Real Cloudflare R2 binding: not yet deployed/verified
- Real Microsoft Office Viewer: not tested against real files
- Dedicated isolated preview project/DB: not yet provisioned
- Production deployment: not performed
