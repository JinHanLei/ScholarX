function isInvalidModelId(modelId) {
  const value = String(modelId || '').trim();
  return !value || value.includes('@') || /\s/.test(value);
}

function modelFamily(modelId) {
  const value = String(modelId || '').trim();
  const prefix = value.split(/[-_.]/)[0] || 'other';
  return prefix.toLowerCase();
}

function groupModels(models = []) {
  const groups = new Map();
  models.forEach((model) => {
    const family = modelFamily(model.id || model.name);
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(model);
  });
  return [...groups.entries()].map(([family, items]) => ({ family, items }));
}

function initialLlmSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('scholarx.llmSettings') || '{}');
    return {
      mode: 'single',
      ...saved,
      protocol: '',
      model: isInvalidModelId(saved.model) ? '' : saved.model,
    };
  } catch {
    return { mode: 'single', model: '', protocol: '' };
  }
}

export { groupModels, initialLlmSettings, isInvalidModelId };
