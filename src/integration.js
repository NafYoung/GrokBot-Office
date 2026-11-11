// 只生成配置，不触发 Webhook、不发送任务，也不声称已修改 Grokbot。
export function setupIntegration() {
  const get = (id) => document.getElementById(id);
  const generate = get('generateIntegration');
  const copy = get('copyIntegration');
  const instructions = get('integrationInstructions');
  const message = get('integrationMessage');
  generate.addEventListener('click', async () => {
    generate.disabled = true;
    message.textContent = '正在读取当前办公室配置…';
    instructions.value = '';
    for (const element of [instructions, copy, get('integrationLabel')]) element.hidden = true;
    try {
      const response = await fetch('/api/integration');
      if (!response.ok) {
        message.textContent = response.status === 401 ? '请先解锁办公室，再生成接入指令。'
          : '无法读取配置，请更新代码并重启办公室服务。';
        return;
      }
      const config = await response.json();
      if (config.protocol !== 'grokbot-office-v1' || typeof config.instructions !== 'string') {
        throw new Error('unsupported office');
      }
      instructions.value = config.instructions;
      for (const element of [instructions, copy, get('integrationLabel')]) element.hidden = false;
      message.textContent = `办公室电脑：${config.machine}。指令已生成，尚未修改 Grokbot；保存规则并收到实际任务上报后，才算接通。`;
    } catch {
      message.textContent = '无法读取配置，请确认办公室服务仍在运行。';
    } finally {
      generate.disabled = false;
    }
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(instructions.value);
      message.textContent = '已复制。请保存到需要同步的 Bot 长期指令中，然后执行一个真实任务验证。';
    } catch {
      instructions.focus();
      instructions.select();
      message.textContent = '浏览器未允许自动复制，文字已选中，请手动复制。';
    }
  });
}
