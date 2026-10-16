# yourz.top 云盘与操作留痕：上线前检查清单

本功能目前只在 `test/cloud-drive-audit-v1` 分支中开发。不要直接合并到 `main` 或执行正式部署，直到完成下面的 R2 配置和人工验收。

## 当前功能

- 无登录页面；首次访问建立匿名浏览器访客 ID 和共享编辑会话。
- 记录 IP、Cloudflare 提供的 IP 粗略地区、User-Agent、浏览器与操作系统；可由用户填写设备备注。它不是经验证的物理电脑标识。
- 记录工厂页面/资料查看、工厂查询、工厂增删改、云盘列表、文件上传/下载/预览/替换、版本恢复、回收站恢复/删除、设备备注修改。
- 通过 R2 保存原文件；D1 保存文件索引、版本元数据、匿名访客和审计日志。
- 单文件上传目前限制 25 MB；支持 DOC、DOCX、XLS、XLSX、PPT、PPTX、PDF、CSV、TXT 和常见图片。云盘列表采用分页。
- PDF/常见图片由网站直接预览；Office 预览用 Microsoft Office Online Viewer 的短期链接。

## 上线前必须完成

1. 在 Cloudflare R2 中创建私有 bucket，例如 `yourz-documents`。
2. 在 Cloudflare Pages 项目 `yourz-website` 中打开 Settings → Bindings → Add → R2 bucket，变量名必须设为 `FILES`，并选择上述 bucket。Cloudflare 官方说明：绑定必须先有 bucket，再添加绑定；部署后才生效。生产环境与 Preview 环境的绑定可分开配置。参考：https://developers.cloudflare.com/pages/functions/bindings/
3. 预览环境不要绑定生产文件桶；如果以后做真正的 Pages 测试部署，应另建独立测试 bucket，防止测试文件污染生产数据。
4. 先做一次测试部署，并用真实的 DOCX、XLSX、PPTX、PDF 文件验证中文文件名、Office Viewer、下载、版本恢复与回收站。
5. 核对访问/操作日志。当前有日志写入能力，但日志查看页的开放范围按需求暂缓，之后再由项目所有者确定。
6. 核对备份策略、日志保留期和访问留痕告知。访客 ID 依赖浏览器 Cookie；删除 Cookie、换浏览器或使用 VPN 都会影响设备关联；IP 地区为估算而非 GPS。

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
- Real Cloudflare R2 binding: not configured
- Real Microsoft Office Viewer: not tested against production files
- Production deployment: not performed
