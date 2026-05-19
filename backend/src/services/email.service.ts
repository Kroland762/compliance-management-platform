import nodemailer from 'nodemailer';
import { config } from '../config';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter && config.smtp.host) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? {
        user: config.smtp.user,
        pass: config.smtp.pass,
      } : undefined,
    });
  }
  return transporter;
}

class EmailService {

  async send(to: string, subject: string, html: string): Promise<boolean> {
    const transport = getTransporter();
    if (!transport) {
      console.log('[Email] SMTP 未配置，跳过发送:', subject);
      return false;
    }
    try {
      await transport.sendMail({
        from: config.smtp.from,
        to,
        subject,
        html,
      });
      console.log('[Email] 发送成功:', to, subject);
      return true;
    } catch (error) {
      console.error('[Email] 发送失败:', error);
      return false;
    }
  }

  async notifyTaskAssigned(email: string, username: string, taskTarget: string, taskType: string) {
    return this.send(
      email,
      `【合规审计平台】新审计任务已分配：${taskTarget}`,
      `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#1D1D1F">新审计任务</h2>
        <p>${username}，您好：</p>
        <p>您有一个新的审计任务需要填写：</p>
        <div style="background:#F5F5F7;padding:16px;border-radius:12px;margin:16px 0">
          <strong>评估方式：</strong>${taskType}<br/>
          <strong>评估对象：</strong>${taskTarget}
        </div>
        <p>请登录系统完成问卷填写。</p>
        <a href="${config.frontendUrl}" style="display:inline-block;padding:12px 24px;background:#007AFF;color:#fff;border-radius:10px;text-decoration:none;font-weight:500">登录合规审计平台</a>
        <p style="color:#8E8E93;font-size:12px;margin-top:24px">此邮件由系统自动发送，请勿回复。</p>
      </div>`,
    );
  }

  async notifyTaskReturned(email: string, username: string, taskTarget: string, reason: string) {
    return this.send(
      email,
      `【合规审计平台】审计任务已退回：${taskTarget}`,
      `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#FF3B30">任务退回</h2>
        <p>${username}，您好：</p>
        <p>您的审计任务已被退回，需要修改后重新提交：</p>
        <div style="background:#FFF3F0;padding:16px;border-radius:12px;margin:16px 0">
          <strong>评估对象：</strong>${taskTarget}<br/>
          <strong>退回原因：</strong>${reason}
        </div>
        <a href="${config.frontendUrl}" style="display:inline-block;padding:12px 24px;background:#007AFF;color:#fff;border-radius:10px;text-decoration:none;font-weight:500">登录修改</a>
      </div>`,
    );
  }

  async sendReminder(email: string, username: string, taskTarget: string) {
    return this.send(
      email,
      `【合规审计平台】问卷填写提醒：${taskTarget}`,
      `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#FF9500">填写提醒</h2>
        <p>${username}，您好：</p>
        <p>您的审计任务「${taskTarget}」尚未完成，请尽快登录系统填写问卷。</p>
        <a href="${config.frontendUrl}" style="display:inline-block;padding:12px 24px;background:#007AFF;color:#fff;border-radius:10px;text-decoration:none;font-weight:500;margin-top:12px">去填写</a>
      </div>`,
    );
  }
}

export default new EmailService();
