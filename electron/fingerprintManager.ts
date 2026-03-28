/**
 * fingerprintManager.ts
 *
 * Native C# (.NET) Bridge for FlexCode SDK.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, spawnSync } from 'child_process';

const DOTNET_CSC = 'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe';
const BRIDGE_EXE = path.join(os.tmpdir(), 'marviano_fp_bridge.exe');

const BRIDGE_CS_SOURCE = [
  'using System;',
  'using System.Collections.Generic;',
  'using System.Runtime.InteropServices;',
  'using System.Windows.Forms;',
  'using System.Reflection;',
  'using System.Text;',
  'using System.IO;',
  '',
  'namespace Marviano',
  '{',
  '    class BridgeForm : Form',
  '    {',
  '        private object _sdk;',
  '        private string _action;',
  '        private string _sn, _vc, _ac;',
  '        private List<string[]> _templates = new List<string[]>();',
  '        private int _lastStatus = -999;',
  '        private DateTime _lastLog = DateTime.Now;',
  '        private string _statusProp = null;',
  '        private string _templateProp = null;',
  '',
  '        private void Log(string msg) { Console.WriteLine("{\\\"type\\\":\\\"log\\\",\\\"message\\\":\\\"" + msg + "\\\"}"); }',
  '',
  '        public BridgeForm(string jsonPath)',
  '        {',
  '            this.Text = "Marviano FP Bridge";',
  '            this.Width = 300; this.Height = 200;',
  '            this.StartPosition = FormStartPosition.CenterScreen;',
  '            try {',
  '                string raw = File.ReadAllText(jsonPath);',
  '                _action = GetJsonVal(raw, "action");',
  '                _sn = GetJsonVal(raw, "sn");',
  '                _vc = GetJsonVal(raw, "vc");',
  '                _ac = GetJsonVal(raw, "ac");',
  '',
  '                if (_action == "verify") {',
  '                    if (raw.Contains("\\\"templates\\\"")) {',
  '                        string tPart = raw.Substring(raw.IndexOf("\\\"templates\\\""));',
  '                        int start = tPart.IndexOf("[");',
  '                        int end = tPart.LastIndexOf("]");',
  '                        if (start != -1 && end != -1) {',
  '                            string tArray = tPart.Substring(start + 1, end - start - 1);',
  '                            string[] items = tArray.Split(new string[] { "}," }, StringSplitOptions.None);',
  '                            foreach (var item in items) {',
  '                                string id = GetJsonVal(item, "employee_id");',
  '                                string data = GetJsonVal(item, "template_data");',
  '                                if (!string.IsNullOrEmpty(id) && !string.IsNullOrEmpty(data)) {',
  '                                    _templates.Add(new string[] { id, data });',
  '                                }',
  '                            }',
  '                        }',
  '                    }',
  '                }',
  '            } catch (Exception ex) {',
  '                Console.WriteLine("{\\\"type\\\":\\\"error\\\",\\\"message\\\":\\\"Config parse error: \" + ex.Message + \"\\\"}");',
  '                Application.Exit();',
  '            }',
  '        }',
  '',
  '        private string GetJsonVal(string json, string key) {',
  '            string pattern = "\\\"" + key + "\\\":\\\"";',
  '            int start = json.IndexOf(pattern);',
  '            if (start == -1) {',
  '                pattern = "\\\"" + key + "\\\":";',
  '                start = json.IndexOf(pattern);',
  '                if (start == -1) return "";',
  '                int vstart = start + pattern.Length;',
  '                int vend = json.IndexOf(",", vstart);',
  '                if (vend == -1) vend = json.IndexOf("}", vstart);',
  '                if (vend == -1) return json.Substring(vstart).Trim().Replace("\\\"", "");',
  '                return json.Substring(vstart, vend - vstart).Trim().Replace("\\\"", "");',
  '            } else {',
  '                int vstart = start + pattern.Length;',
  '                int vend = json.IndexOf("\\\"", vstart);',
  '                if (vend == -1) return "";',
  '                return json.Substring(vstart, vend - vstart);',
  '            }',
  '        }',
  '',
  '        protected override void OnLoad(EventArgs e)',
  '        {',
  '            base.OnLoad(e);',
  '            if (_action == "enroll") Enroll();',
  '            else if (_action == "verify") Verify();',
  '            else if (_action == "check") Check();',
  '            else Application.Exit();',
  '        }',
  '',
  '        private void Check() {',
  '            try {',
  '                Type t = Type.GetTypeFromProgID("FlexCodeSDK.FinFPReg");',
  '                if (t != null) Console.WriteLine("{\\\"type\\\":\\\"ready\\\",\\\"connected\\\":true}");',
  '                else Console.WriteLine("{\\\"type\\\":\\\"error\\\",\\\"message\\\":\\\"SDK Not Registered\\\"}");',
  '            } catch { Console.WriteLine("{\\\"type\\\":\\\"error\\\",\\\"message\\\":\\\"Check Failed\\\"}"); }',
  '            Application.Exit();',
  '        }',
  '',
  '        private void Enroll()',
  '        {',
  '            try {',
  '                Log("Probing FinFPReg...");',
  '                Type t = Type.GetTypeFromProgID("FlexCodeSDK.FinFPReg");',
  '                _sdk = Activator.CreateInstance(t);',
  '                ',
  '                // Discovery: Find the correct property names',
  '                string[] statusCandidates = { "RegistrationStatus", "RegStatus", "Status", "State" };',
  '                foreach (var s in statusCandidates) {',
  '                    try { t.InvokeMember(s, BindingFlags.GetProperty, null, _sdk, null); _statusProp = s; break; } catch {}',
  '                }',
  '                string[] templateCandidates = { "FPRegistrationTemplate", "RegTemplate", "Template" };',
  '                foreach (var s in templateCandidates) {',
  '                    try { t.InvokeMember(s, BindingFlags.GetProperty, null, _sdk, null); _templateProp = s; break; } catch {}',
  '                }',
  '',
  '                Log("Discovery result: Status=" + (_statusProp??"NONE") + ", Template=" + (_templateProp??"NONE"));',
  '',
  '                string[] initMethods = { "AddDeviceInfo", "SetDeviceInfo", "Init" };',
  '                foreach (var method in initMethods) {',
  '                    try {',
  '                        t.InvokeMember(method, BindingFlags.InvokeMethod | BindingFlags.OptionalParamBinding, null, _sdk, new object[] { _sn, _vc, _ac });',
  '                        Log("Success: " + method);',
  '                        break;',
  '                    } catch {}',
  '                }',
  '',
  '                Timer poll = new Timer();',
  '                poll.Interval = 200;',
  '                poll.Tick += (s, ev) => {',
  '                    try {',
  '                        if (_statusProp == null) return;',
  '                        object statusObj = t.InvokeMember(_statusProp, BindingFlags.GetProperty, null, _sdk, null);',
  '                        int status = Convert.ToInt32(statusObj);',
  '                        if (status != _lastStatus || (DateTime.Now - _lastLog).TotalSeconds > 3) {',
  '                            Log("Status: " + status);',
  '                            _lastStatus = status;',
  '                            _lastLog = DateTime.Now;',
  '                        }',
  '                        if (status == 0) {',
  '                            string tmpl = (string)t.InvokeMember(_templateProp, BindingFlags.GetProperty, null, _sdk, null);',
  '                            Console.WriteLine("{\\\"type\\\":\\\"enrolled\\\",\\\"templateBase64\\\":\\\"\" + tmpl + \"\\\"}");',
  '                            Application.Exit();',
  '                        } else if (status != 10 && status != -1 && status < 5) {',
  '                             Console.WriteLine("{\\\"type\\\":\\\"progress\\\",\\\"samplesRemaining\\\":" + (4-status) + ",\\\"message\\\":\\\"Scan " + status + " berhasil\\\"}");',
  '                        }',
  '                    } catch (Exception ex) { Log("Poll err: " + ex.Message); }',
  '                };',
  '                poll.Start();',
  '',
  '                string[] startMethods = { "FPRegistrationStart", "RegistrationStart", "Start" };',
  '                foreach (var method in startMethods) {',
  '                    try {',
  '                        t.InvokeMember(method, BindingFlags.InvokeMethod | BindingFlags.OptionalParamBinding, null, _sdk, new object[] { _ac });',
  '                        Log("Success: " + method);',
  '                        break;',
  '                    } catch {}',
  '                }',
  '                Log("Ready.");',
  '            } catch (Exception ex) { Console.WriteLine("{\\\"type\\\":\\\"error\\\",\\\"message\\\":\\\"" + ex.Message + \"\\\"}"); Application.Exit(); }',
  '        }',
  '',
  '        private void Verify()',
  '        {',
  '            try {',
  '                Log("Probing FinFPVer...");',
  '                Type t = Type.GetTypeFromProgID("FlexCodeSDK.FinFPVer");',
  '                _sdk = Activator.CreateInstance(t);',
  '                ',
  '                string[] statusCandidates = { "VerificationStatus", "VerStatus", "Status", "State" };',
  '                foreach (var s in statusCandidates) {',
  '                    try { t.InvokeMember(s, BindingFlags.GetProperty, null, _sdk, null); _statusProp = s; break; } catch {}',
  '                }',
  '                Log("Discovery result: Status=" + (_statusProp??"NONE"));',
  '',
  '                string[] initMethods = { "AddDeviceInfo", "SetDeviceInfo", "Init" };',
  '                foreach (var method in initMethods) {',
  '                    try {',
  '                        t.InvokeMember(method, BindingFlags.InvokeMethod | BindingFlags.OptionalParamBinding, null, _sdk, new object[] { _sn, _vc, _ac });',
  '                        Log("Success: " + method);',
  '                        break;',
  '                    } catch {}',
  '                }',
  '',
  '                foreach (var tpl in _templates) {',
  '                    try { t.InvokeMember("FPLoad", BindingFlags.InvokeMethod, null, _sdk, new object[] { tpl[0], 0, tpl[1], "SalesPulseFP" + tpl[0] }); } catch {}',
  '                }',
  '                ',
  '                Timer poll = new Timer();',
  '                poll.Interval = 200;',
  '                poll.Tick += (s, ev) => {',
  '                    try {',
  '                        if (_statusProp == null) return;',
  '                        object statusObj = t.InvokeMember(_statusProp, BindingFlags.GetProperty, null, _sdk, null);',
  '                        int status = Convert.ToInt32(statusObj);',
  '                        if (status != _lastStatus || (DateTime.Now - _lastLog).TotalSeconds > 3) {',
  '                            Log("Status: " + status);',
  '                            _lastStatus = status;',
  '                            _lastLog = DateTime.Now;',
  '                        }',
  '                        if (status == 1 || status == 2) {',
  '                            string id = (string)t.InvokeMember("FPVerificationID", BindingFlags.GetProperty, null, _sdk, null);',
  '                            Console.WriteLine("{\\\"type\\\":\\\"identified\\\",\\\"employeeId\\\":\\\"\" + id + \"\\\"}");',
  '                            Application.Exit();',
  '                        }',
  '                    } catch {}',
  '                };',
  '                poll.Start();',
  '                ',
  '                string[] startMethods = { "FPVerificationStart", "VerificationStart", "Start" };',
  '                foreach (var method in startMethods) {',
  '                    try {',
  '                        t.InvokeMember(method, BindingFlags.InvokeMethod | BindingFlags.OptionalParamBinding, null, _sdk, null);',
  '                        Log("Success: " + method);',
  '                        break;',
  '                    } catch {}',
  '                }',
  '                Log("Ready.");',
  '            } catch (Exception ex) { Console.WriteLine("{\\\"type\\\":\\\"error\\\",\\\"message\\\":\\\"" + ex.Message + \"\\\"}"); Application.Exit(); }',
  '        }',
  '',
  '        [STAThread]',
  '        static void Main(string[] args)',
  '        {',
  '            if (args.Length < 1) return;',
  '            Application.Run(new BridgeForm(args[0]));',
  '        }',
  '    }',
  '}'
].join('\n');

// --- Types ---

export type CaptureEvent =
  | { type: 'sample_captured';   message: string; samplesRemaining: number; image?: string }
  | { type: 'error';             message: string };

export type EnrollResult = {
  templateBase64: string;
  quality: number;
};

export type IdentifyResult = {
  employeeId: number;
  score: number;
};

export type FpError = {
  code: 'NO_SDK' | 'CAPTURE_FAILED' | 'ENROLL_FAILED' | 'IDENTIFY_FAILED' | 'INVALID_CREDENTIALS';
  message: string;
};

export type OnProgress = (event: CaptureEvent) => void;

export type StoredTemplate = {
  employee_id: number;
  template_data: string; // Base64
};

// --- Headers & Credentials ---

let _sn = '';
let _vc = '';
let _ac = '';

export function setCredentials(sn: string, vc: string, ac: string): void {
  _sn = sn.trim();
  _vc = vc.trim();
  _ac = ac.trim();
}

export function setVKey(vk: string): void {
  _ac = vk.trim();
}

/**
 * Compiles the C# bridge source into a 32-bit executable.
 */
function ensureBridgeCompiled(): string {
  if (fs.existsSync(BRIDGE_EXE)) {
    try { fs.unlinkSync(BRIDGE_EXE); } catch(e) {}
  }

  console.log('[FP Bridge] Compiling diagnostic native C# bridge...');
  const sourceFile = path.join(os.tmpdir(), 'marviano_fp_bridge.cs');
  fs.writeFileSync(sourceFile, BRIDGE_CS_SOURCE, 'utf8');

  const res = spawnSync(DOTNET_CSC, [
    '/target:winexe',
    '/platform:x86',
    '/out:' + BRIDGE_EXE,
    '/reference:System.Windows.Forms.dll,System.dll',
    sourceFile
  ]);

  try { if (fs.existsSync(sourceFile)) fs.unlinkSync(sourceFile); } catch(e) {}

  if (res.status !== 0) {
    const err = res.stderr?.toString() || res.stdout?.toString() || 'Unknown compilation error';
    console.error('[FP Bridge] Compilation failed:', err);
    throw new Error('Failed to compile C# bridge: ' + err);
  }

  console.log('[FP Bridge] Compilation successful:', BRIDGE_EXE);
  return BRIDGE_EXE;
}

/**
 * Runs the compiled bridge.
 */
function runBridge(
  command: Record<string, any>,
  onProgress?: (obj: any) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const runId = Date.now() + "_" + Math.floor(Math.random() * 1000);
      const tmpDir = os.tmpdir();
      const cmdFile = path.join(tmpDir, 'marviano_fp_cmd_' + runId + '.json');
      const exe = ensureBridgeCompiled();

      // Write command to file
      fs.writeFileSync(cmdFile, JSON.stringify(command), 'utf8');

      const proc = spawn(exe, [cmdFile]);
      let lastResult: any = null;

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/).filter((l: string) => l.trim().length > 0);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'progress') {
              onProgress?.(obj);
            } else if (obj.type === 'log') {
              console.log('[FP Bridge DEBUG] ' + obj.message);
            } else {
              lastResult = obj;
            }
          } catch {
            console.log('[FP Bridge raw]', line);
          }
        }
      });

      proc.on('close', (code) => {
        // Cleanup
        try { if (fs.existsSync(cmdFile)) fs.unlinkSync(cmdFile); } catch(e){}

        if (lastResult && lastResult.type !== 'error') {
          resolve(lastResult);
        } else {
          reject({
            code: 'CAPTURE_FAILED',
            message: lastResult?.message || ('Bridge exited with code ' + code)
          });
        }
      });
    } catch (err: any) {
      reject({ code: 'NO_SDK', message: err.message });
    }
  });
}

// --- Public API ---

export async function checkReaderConnected(): Promise<{ connected: boolean; message: string }> {
  try {
    const res = await runBridge({ action: 'check', sn: _sn, vc: _vc, ac: _ac });
    return { connected: res.connected === true, message: 'Native Bridge Ready' };
  } catch (err: any) {
    return { connected: false, message: err.message || String(err) };
  }
}

export async function enrollFingerprint(
  employeeId: number,
  onProgress?: OnProgress
): Promise<EnrollResult> {
  if (!_sn || !_vc || !_ac) {
    throw ({ code: 'INVALID_CREDENTIALS', message: 'Credential belum diatur.' } as FpError);
  }

  const res = await runBridge({ action: 'enroll', sn: _sn, vc: _vc, ac: _ac, employeeId }, (obj) => {
    if (obj.type === 'progress' && onProgress) {
      onProgress({
        type: 'sample_captured',
        message: obj.message || 'Scanning...',
        samplesRemaining: typeof obj.samplesRemaining === 'number' ? obj.samplesRemaining : 0
      });
    }
  });

  if (res.type === 'enrolled') {
    return {
      templateBase64: res.templateBase64 as string,
      quality: 100
    };
  }

  throw ({ code: 'ENROLL_FAILED', message: res.message || 'Enrollment failed' } as FpError);
}

export async function identifyFingerprint(
  storedTemplates: StoredTemplate[],
  onProgress?: OnProgress
): Promise<IdentifyResult> {
  if (!_sn || !_vc || !_ac) {
    throw ({ code: 'INVALID_CREDENTIALS', message: 'Credential belum diatur.' } as FpError);
  }

  const res = await runBridge({ action: 'verify', sn: _sn, vc: _vc, ac: _ac, templates: storedTemplates }, (obj) => {
    if (obj.type === 'progress' && onProgress) {
      onProgress({
        type: 'sample_captured',
        message: obj.message || 'Identifying...',
        samplesRemaining: 0
      });
    }
  });

  if (res.type === 'identified') {
    return {
      employeeId: parseInt(String(res.employeeId), 10),
      score: 100
    };
  }

  throw ({ code: 'IDENTIFY_FAILED', message: res.message || 'No match found' } as FpError);
}
