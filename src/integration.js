// 只生成配置，不触发 Webhook、不发送任务，也不声称已修改 Grokbot。
import { AGENTS } from './config.js';

export function setupIntegration() {
  const get = (id) => document.getElementById(id);
  const generate = get('generateIntegration');
  const copy = get('copyIntegration');
  const instructions = get('integrationInstructions');
  const message = get('integrationMessage');
  const selector = get('integrationAgent');
  for (const agent of AGENTS) selector.add(new Option(`${agent.name} · ${agent.id}`, agent.id));
  let requestGeneration = 0;
  let recipient = '';
  function clearInstructions() {
    instructions.value = '';
    recipient = '';
    for (const element of [instructions, copy, get('integrationLabel')]) element.hidden = true;
  }
  selector.addEventListener('change', () => {
    requestGeneration++;
    clearInstructions();
    generate.disabled = false;
    message.textContent = selector.value ? '生成后，请把规则保存到所选 Bot 自己的长期指令中。' : '';
  });
  generate.addEventListener('click', async () => {
    const agentId = selector.value;
    if (!agentId) {
      message.textContent = '请先选择要连接的 Bot。主 Bot 的规则不能替代其他成员的配置。';
      return;
    }
    const current = ++requestGeneration;
    generate.disabled = true;
    message.textContent = '正在读取当前办公室配置…';
    clearInstructions();
    try {
      const response = await fetch(`/api/integration?agent=${encodeURIComponent(agentId)}`);
      if (current !== requestGeneration) return;
      if (!response.ok) {
        message.textContent = response.status === 401 ? '请先解锁办公室，再生成接入指令。'
          : '无法读取配置，请更新代码并重启办公室服务。';
        return;
      }
      const config = await response.json();
      if (current !== requestGeneration) return;
      if (config.protocol !== 'grokbot-office-v1' || typeof config.instructions !== 'string' || config.agent?.id !== agentId) {
        message.textContent = '服务没有返回这个 Bot 的专属配置，请更新代码并重启办公室。';
        return;
      }
      recipient = config.agent.name;
      instructions.value = config.instructions;
      get('integrationLabel').textContent = `只交给「${recipient}」的配置说明（不含口令）`;
      for (const element of [instructions, copy, get('integrationLabel')]) element.hidden = false;
      message.textContent = `已为「${recipient}」生成专属规则，办公室电脑：${config.machine}。尚未修改 Grokbot；请在这个 Bot 的长期指令中保存并验证。`;
    } catch {
      if (current === requestGeneration) message.textContent = '无法读取配置，请确认办公室服务仍在运行。';
    } finally {
      if (current === requestGeneration) generate.disabled = false;
    }
  });
  copy.addEventListener('click', async () => {
    const current = requestGeneration;
    const name = recipient;
    try {
      await navigator.clipboard.writeText(instructions.value);
      if (current === requestGeneration) message.textContent = `已复制。请交给「${name}」保存为长期规则，然后在它的新任务中验证；不要只发给主 Bot。`;
    } catch {
      if (current !== requestGeneration) return;
      instructions.focus();
      instructions.select();
      message.textContent = '浏览器未允许自动复制，文字已选中，请手动复制。';
    }
  });
}
