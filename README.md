# yourz.top 工厂资料库（腾讯云自托管）

本仓库用于部署工厂资料库应用。**不使用 Render**，直接在腾讯云轻量应用服务器上用 Docker Compose 运行 Node.js + SQLite，并由 Caddy 自动处理 HTTPS。

## 当前版本

- 使用同一个服务器端 SQLite 数据库，员工看到和修改的是同一份记录。
- 包含工厂档案、库存核实、沟通历史、联系人、跟进事项、搜索、回收站、团队权限、CSV 导出和 JSON 备份/恢复。
- 企业微信未接入前使用临时本地团队账号。管理员可在 Team 页面为同事创建独立账号并设置只读/可编辑权限。以后切换企业微信登录时，共享数据库可以保留。
- 初始数据为空；不会自动导入 Excel，也不会生成虚构工厂资料。
- 临时账号用于第一阶段同事协作，不是企业微信身份。不要把资料库设成匿名公开编辑。

## 一、购买服务器

腾讯云官方产品页：https://cloud.tencent.com/product/lighthouse

建议起步配置：Linux、2 核 CPU、2 GB 内存、40 GB SSD、分配公网 IPv4。应用需要持续运行的 Node.js 服务和持久化磁盘，不能用纯静态网页托管替代。

地域选择：
- 希望先快速上线、暂不处理 ICP 备案：可考虑中国香港节点。中国内地访问香港节点可能出现延迟或丢包，正式供义乌、深圳同事长期使用前应实际测试。
- 希望长期稳定用于中国大陆团队：选择中国大陆节点，但绑定域名前需完成 ICP 备案。域名目前实名在个人名下，企业用途的备案主体和域名实名一致性需先确认。

腾讯云地域/网络说明：https://cloud.tencent.com/document/product/1207/50103
价格以购买时控制台为准：https://cloud.tencent.com/document/product/1207/73452

在轻量服务器防火墙/安全组中放通入站 TCP 80 和 443。管理 SSH 的 22 端口建议只允许自己的管理 IP，或使用腾讯云控制台 WebShell。

## 二、域名解析

取得服务器公网 IPv4 后，在域名 DNS 管理里添加一条记录：主机记录 @，记录类型 A，记录值填写服务器公网 IPv4，TTL 使用默认值即可。如存在指向旧服务器的冲突 A/AAAA 记录，确认无用后再移除。不要在确认目标地址前填写 DNS。

## 三、在服务器部署

通过腾讯云控制台 WebShell 登录服务器，安装 Docker。依次执行：

    sudo apt-get update
    sudo apt-get install -y ca-certificates curl git
    curl -fsSL https://get.docker.com | sudo sh
    sudo systemctl enable --now docker

克隆仓库并准备配置：

    sudo git clone https://github.com/Leo-miles/yourz-website.git /opt/yourz-website
    cd /opt/yourz-website
    sudo cp .env.example .env
    sudo nano .env

编辑 .env，设置 DOMAIN=yourz.top、BASE_URL=https://yourz.top、AUTH_MODE=local、LOCAL_ADMIN_USER=admin、TIME_ZONE=Asia/Shanghai。为 LOCAL_ADMIN_PASSWORD 填写你自己生成的长随机密码（至少 14 个字符）。只填在服务器的 .env 文件，不要发在聊天里或提交到 GitHub。首次启动前设置好；管理员账号创建后，仅修改此变量不会自动重置数据库里的密码。

启动并查看状态：

    sudo docker compose up -d --build
    sudo docker compose ps
    sudo docker compose logs --tail=100 app web

确认 app 和 web 运行正常。Caddy 会在域名已解析到此服务器、外部可访问 80/443 且证书验证通过时自动申请 HTTPS。随后打开 https://yourz.top。

## 四、创建同事账号并验证共享

1. 用管理员账号进入网站。
2. 打开 Team / 团队权限，为每位同事创建独立账号，选择只读或可编辑权限。
3. 用第二个账号/另一台设备新增测试工厂记录，再确认另一个账号能看到它。
4. 测试搜索、保存、库存和沟通关联记录、回收站、CSV 导出和 JSON 备份。
5. 定期下载应用内备份，并在腾讯云控制台配置快照。数据库保存在 Docker 持久化卷中，不要删除数据卷。

## 常用维护命令

    cd /opt/yourz-website
    sudo docker compose logs -f app web
    sudo docker compose restart app web
    sudo docker compose up -d --build

不要运行 docker compose down -v，因为它会删除持久化数据卷。服务器 .env 和数据库备份应保存在公司可控的安全位置。

## 后续企业微信和小程序

本阶段不需要企业微信凭据。等网页运行、同事协作验证完成后，再单独配置企业微信自建应用、可信域名和服务器可信 IP。小程序是后续的独立接入工作，网站上线不代表小程序已经完成。
