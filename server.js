// 简单 Node.js 后端：接收投递表单并给候选人发「录用」邮件

const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

// 解析表单 application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));
// 解析 JSON（如果后面想用 fetch 也可以）
app.use(express.json());
// 静态文件：把当前目录下的页面通过 http://localhost:3000 访问
app.use(express.static(__dirname));

const transporter = nodemailer.createTransport({
  host: "smtp.qq.com", // QQ 邮箱 SMTP 服务器
  port: 465,
  secure: true,
  auth: {
    // 优先使用环境变量，避免明文写死在代码中
    user: process.env.SMTP_USER || "1434845299@qq.com",
    pass: process.env.SMTP_PASS || "uytddpgxicehfgje"
  }
});

app.post("/api/apply", async (req, res) => {
  const { name, email, position, story } = req.body;

  if (!email) {
    return res.status(400).send("邮箱必填");
  }

  const displayName = (name || "这位神秘阿巴友").trim();
  const displayPosition = position || "你自创的传奇岗位";
  const baseSalary = "100k/月 × 20 薪";

  const plainText = [
    `${displayName} 你好：`,
    "",
    `恭喜你，在阿巴阿巴互联网集团的「${displayPosition}」岗位中，`,
    "凭借你精彩的阿巴能力，已经在我们的想象宇宙中成功拿到 Offer！（纯属搞笑）",
    "",
    `本次 Offer 参考薪资为：${baseSalary}（想象用，不具备法律效力）。`,
    "",
    "这是一封纯搞笑的录用通知，不具备任何法律和就业效力。",
    "如果你真的收到了这封邮件，说明我们的后端和 SMTP 配置是好的。",
    "",
    "—— 阿巴阿巴互联网集团 · 虚构 HR 中心"
  ].join("\n");

  const htmlContent = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f7;padding:24px;">
    <table width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;box-shadow:0 18px 40px rgba(15,23,42,0.12);overflow:hidden;">
      <tr>
        <td style="padding:18px 22px;border-bottom:1px solid #f3f4f6;background:linear-gradient(135deg,#ff6a00,#ff9f1a);color:#fff;">
          <div style="font-size:14px;opacity:.9;">阿巴阿巴互联网集团 · Offer 通知（搞笑版）</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px;">${displayPosition} 录用结果</div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 22px 8px 22px;font-size:14px;color:#111827;line-height:1.7;">
          <p style="margin:0 0 12px 0;">${displayName} 你好：</p>
          <p style="margin:0 0 12px 0;">
            经过严谨而抽象的阿巴评审流程，我们非常高兴地通知你：<br />
            你已在 <strong>阿巴阿巴互联网集团</strong> 的想象宇宙中，
            被录用为「<strong>${displayPosition}</strong>」岗位。
          </p>
          <p style="margin:0 0 12px 0;">
            为了不辜负你超越 KPI 的阿巴潜力，我们为你准备了一份「看起来很离谱」的薪资方案：
          </p>
          <table cellspacing="0" cellpadding="0" style="width:100%;margin:10px 0 14px 0;border-collapse:collapse;font-size:13px;">
            <tr>
              <td style="padding:6px 0;color:#6b7280;width:90px;">岗位名称</td>
              <td style="padding:6px 0;color:#111827;">${displayPosition}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6b7280;">薪资结构</td>
              <td style="padding:6px 0;color:#111827;"><strong>${baseSalary}</strong></td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6b7280;">发放说明</td>
              <td style="padding:6px 0;color:#111827;">以 PPT 为准，以段子为主，一切解释权归阿巴宇宙所有。</td>
            </tr>
          </table>
          ${
            story
              ? `<p style="margin:0 0 12px 0;">
                  我们已经认真阅读了你分享的这段「最能阿巴」的经历：<br />
                  <span style="display:inline-block;margin-top:4px;padding:8px 10px;border-radius:10px;background:#f9fafb;border:1px dashed #e5e7eb;color:#4b5563;">
                    ${String(story).replace(/</g, "&lt;").replace(/>/g, "&gt;")}
                  </span>
                </p>`
              : ""
          }
          <p style="margin:0 0 12px 0;color:#6b7280;font-size:12px;">
            温馨提示：本 Offer 仅为搞笑创作，不构成任何真实招聘、录用或法律承诺。<br />
            如果你此刻会心一笑，那这份 Offer 就已经「到账」了。
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 22px 18px 22px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;background:#f9fafb;">
          <div>—— 阿巴阿巴互联网集团 · 虚构 HR 中心</div>
          <div style="margin-top:4px;">
            若你愿意，可以把这封邮件截图发给正在加班的朋友，一起加入阿巴宇宙。
          </div>
        </td>
      </tr>
    </table>
  </div>
  `;

  const mailOptions = {
    from: `"阿巴阿巴互联网集团 HR" <1434845299@qq.com>`, // 和上面 auth.user 一致
    to: email,
    subject: `【阿巴阿巴】恭喜你被录用为：${displayPosition}`,
    text: plainText,
    html: htmlContent
  };

  try {
    await transporter.sendMail(mailOptions);
    // 成功后跳转回首页，并带上成功标记
    res.redirect("/aba-aba-company.html?applySuccess=1");
  } catch (err) {
    console.error("发送邮件失败:", err);
    // 失败也跳回首页，只是带上错误标记
    res.redirect("/aba-aba-company.html?applyError=1");
  }
});

app.listen(PORT, () => {
  console.log(`阿巴阿巴后端已在 http://localhost:${PORT} 启动`);
});

