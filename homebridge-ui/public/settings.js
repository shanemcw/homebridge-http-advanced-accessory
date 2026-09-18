/* global homebridge, document */
(() => {
  const $ = id => document.getElementById(id);
  const fields = [
    ['requestTimeout', 'Request timeout (ms)', 10000],
    ['uriCallsDelay', 'Request spacing per device (ms)', 0],
    ['setterDelay', 'Setter debounce (ms)', 0],
    ['writeConfirmationTimeout', 'Write confirmation window (ms)', 10000],
    ['refresh.activeInterval', 'Active refresh interval (seconds)', 5],
    ['refresh.idleInterval', 'Idle refresh interval (seconds)', 60],
    ['refresh.idleAfter', 'Idle after (seconds)', 60],
    ['recovery.retryInterval', 'First recovery retry (seconds)', 5],
    ['recovery.maxRetryInterval', 'Maximum recovery retry (seconds)', 30],
    ['recovery.quietPeriod', 'Wait before outage warning (seconds)', 90],
    ['recovery.reminderInterval', 'Outage reminder interval (seconds)', 300],
    ['coordinator.concurrency', 'Concurrent requests per process', 4],
    ['coordinator.perOrigin', 'Concurrent requests per endpoint', 2],
    ['coordinator.maxQueue', 'Maximum queued requests', 256],
  ];
  let loaded;
  let hasChanges = false;
  let saving = false;
  let platformEditors = [];
  const message = (text, error = false) => {
    $('status').textContent = text; $('status').className = error ? 'text-danger' : '';
    if (error) { $('status').tabIndex = -1; $('status').focus(); }
  };
  const parse = (editor, label) => {
    try { return JSON.parse(editor.value); }
    catch { throw new Error(`${label} contains invalid JSON; no changes saved`); }
  };
  const addPlatform = block => {
    const index = platformEditors.length + 1;
    const container = document.createElement('div'); container.className = 'platform';
    const enabledLabel = document.createElement('label');
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = block.enabled !== false;
    enabledLabel.append(enabled, ` Enable platform ${index}`);
    const label = document.createElement('label'); label.htmlFor = `platform-${index}`; label.textContent = `Platform ${index} configuration (JSON object)`;
    const editor = document.createElement('textarea'); editor.id = label.htmlFor; editor.className = 'form-control'; editor.spellcheck = false; editor.autocomplete = 'off'; editor.value = JSON.stringify(block, null, 2);
    const note = document.createElement('p'); note.textContent = 'After restart, disabling retains definitions and cached identities but reports devices unavailable for reads and commands. Its name and device IDs determine HomeKit identity.';
    const limitsNote = document.createElement('p');
    limitsNote.textContent = 'When enabled, this platform’s coordinator overrides affect all HTTP Advanced devices in the same Homebridge process. For uniform limits, keep them in Shared settings and remove coordinator from this platform.';
    const showOverrides = value => { limitsNote.hidden = !value?.coordinator || !Object.keys(value.coordinator).length; };
    showOverrides(block);
    enabled.addEventListener('change', () => {
      try {
        const value = parse(editor, `Platform ${index}`);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Platform configuration must be an object');
        value.enabled = enabled.checked; editor.value = JSON.stringify(value, null, 2);
      } catch (error) { enabled.checked = !enabled.checked; message(error.message, true); }
    });
    editor.addEventListener('input', () => { try { const value = JSON.parse(editor.value); enabled.checked = value.enabled !== false; showOverrides(value); } catch { /* allow incomplete JSON while editing */ } });
    container.append(enabledLabel, note, limitsNote, label, editor); $('platforms').append(container);
    platformEditors.push(editor);
  };
  const render = result => {
    loaded = result;
    const accessories = result.draft.accessories;
    $('legacy-count').textContent = `(${accessories.length})`;
    $('legacy-summary').textContent = accessories.length
      ? `${accessories.length} ${accessories.length === 1 ? 'accessory uses' : 'accessories use'} the shared settings below. Manage their individual definitions in JSON Config.`
      : 'No legacy accessories are configured. Add one through JSON Config, or use an optional platform below.';
    $('legacy-list').replaceChildren();
    for (const accessory of accessories) {
      const item = document.createElement('li');
      item.textContent = `${accessory.name} — ${accessory.service}`;
      $('legacy-list').append(item);
    }
    $('legacy-details').hidden = accessories.length === 0;
    $('timings').replaceChildren();
    for (const [key, title, fallback] of fields) {
      const box = document.createElement('div'); const label = document.createElement('label');
      label.htmlFor = key; label.textContent = title;
      const input = document.createElement('input'); input.id = key; input.className = 'form-control'; input.type = 'number'; input.step = key.startsWith('coordinator.') ? '1' : 'any'; input.min = key.startsWith('coordinator.') ? '1' : '0'; input.placeholder = String(fallback);
      const value = key.split('.').reduce((v, k) => v?.[k], result.draft.settings);
      input.value = value === undefined ? '' : String(value);
      const validate = () => {
        const zeroAllowed = ['uriCallsDelay', 'setterDelay', 'writeConfirmationTimeout', 'recovery.quietPeriod'].includes(key);
        input.setCustomValidity(input.value !== '' && !zeroAllowed && Number(input.value) <= 0 ? `${title} must be greater than zero` : '');
      };
      input.addEventListener('input', validate); validate();
      box.append(label, input); $('timings').append(box);
    }
    platformEditors = []; $('platforms').replaceChildren(); result.draft.platforms.forEach(addPlatform);
    $('settings').hidden = false;
    hasChanges = false;
  };
  $('settings').addEventListener('input', () => { hasChanges = true; });
  $('legacy-config').addEventListener('click', () => {
    if (hasChanges) {
      message('Save your changes below before returning to the plugin menu. To discard them, use the dialog’s Close button.', true);
      return;
    }
    homebridge.closeSettings();
  });
  $('add-platform').addEventListener('click', () => {
    const names = platformEditors.map(editor => { try { return JSON.parse(editor.value).name; } catch { return undefined; } });
    let number = 1; let name = 'HTTP Advanced';
    while (names.includes(name)) name = `HTTP Advanced ${++number}`;
    addPlatform({ platform: 'HttpAdvanced', name, enabled: true, devices: [] });
    hasChanges = true;
  });
  $('settings').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !$('settings').reportValidity()) return;
    saving = true; $('settings-fields').disabled = true;
    message('Saving settings…');
    try {
      const draft = structuredClone(loaded.draft);
      // legacy definitions stay unchanged here; JSON Config owns their editing workflow
      draft.platforms = platformEditors.map((editor, index) => parse(editor, `Platform ${index + 1}`));
      for (const [key] of fields) {
        const input = $(key).value;
        const keys = key.split('.'); const property = keys.pop();
        let target = draft.settings;
        for (const section of keys) { target[section] ??= {}; target = target[section]; }
        if (input === '') delete target[property]; else target[property] = Number(input);
        // blank settings should not materialize empty sections in an unchanged config
        if (keys.length && !Object.keys(target).length && loaded.draft.settings[keys[0]] === undefined) delete draft.settings[keys[0]];
      }
      const result = await homebridge.request('/settings/save', { revision: loaded.revision, draft });
      render(result); message(result.changed ? 'Saved. Restart Homebridge to apply these settings.' : 'No changes to save.');
    } catch (error) { message(error.message || 'Could not save settings; no changes saved', true); }
    finally { saving = false; $('settings-fields').disabled = false; }
  });
  homebridge.addEventListener('ready', async () => {
    // the standard save path handles only one plugin alias/type, so both sections use our bounded editor
    homebridge.disableSaveButton();
    try { render(await homebridge.request('/settings/load')); message('Configuration loaded. Changes stay here until you save.'); }
    catch (error) { message(error.message || 'Could not load settings', true); }
  }, { once: true });
})();
