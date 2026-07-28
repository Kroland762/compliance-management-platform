import svgCaptcha from 'svg-captcha';

interface CaptchaEntry {
  code: string;
  expiresAt: number;
}

class CaptchaService {
  private store = new Map<string, CaptchaEntry>();
  private readonly TTL = 5 * 60 * 1000; // 5 分钟有效期

  // 定期清理过期验证码
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref();
  }

  /**
   * 生成图形验证码
   */
  generate(): { captchaId: string; svg: string } {
    const captcha = svgCaptcha.create({
      size: 4,
      noise: 3,
      color: true,
      background: '#f5f5f7',
      ignoreChars: '0oO1iIlL',
      width: 150,
      height: 50,
      fontSize: 42,
    });

    const captchaId = `cap_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    this.store.set(captchaId, {
      code: captcha.text.toLowerCase(),
      expiresAt: Date.now() + this.TTL,
    });

    return { captchaId, svg: captcha.data };
  }

  /**
   * 验证验证码
   * @returns true 表示验证通过，false 表示失败或过期
   */
  verify(captchaId: string, input: string): boolean {
    const entry = this.store.get(captchaId);
    if (!entry) return false;

    // 验证后立即删除，防止重放
    this.store.delete(captchaId);

    if (Date.now() > entry.expiresAt) return false;

    return entry.code === input.toLowerCase().trim();
  }

  /**
   * 清理过期条目
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(id);
      }
    }
  }

  /**
   * 停止清理定时器
   */
  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}

export default new CaptchaService();
