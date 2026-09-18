import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';
import { ConfigEditor, SettingsError } from '../dist/ui-config.js';

class SettingsServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const editor = new ConfigEditor(this.homebridgeConfigPath);
    const handle = work => {
      try { return work(); }
      catch (error) { throw new RequestError(error instanceof SettingsError ? error.message : 'Could not process settings', {}); }
    };
    this.onRequest('/settings/load', () => handle(() => editor.load()));
    this.onRequest('/settings/save', body => handle(() => editor.save(body)));
    this.ready();
  }
}
new SettingsServer();
