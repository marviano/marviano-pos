/**
 * fingerprintManager.ts
 *
 * Native WSH JScript Bridge for FlexCode SDK.
 * Overcomes the missing Interop DLL issues by using JScript's native IDispatch late binding,
 * successfully mapping COM events natively via WScript.ConnectObject!
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

const CSCRIPT_32 = path.join(process.env.windir || 'C:\\WINDOWS', 'SysWOW64', 'cscript.exe');

const BRIDGE_JS_SOURCE = `
var template = '';
var matchedId = '';
var fso = new ActiveXObject("Scripting.FileSystemObject");
var f = fso.OpenTextFile(WScript.Arguments(0), 1);
var raw = f.ReadAll();
f.Close();

function getVal(json, key) {
    var p1 = '"' + key + '":"';
    var i = json.indexOf(p1);
    if (i !== -1) {
        var vs = i + p1.length;
        var ve = json.indexOf('"', vs);
        if (ve === -1) return '';
        return json.substring(vs, ve);
    }
    var p2 = '"' + key + '":';
    i = json.indexOf(p2);
    if (i === -1) return '';
    var vs2 = i + p2.length;
    var ve2 = json.indexOf(',', vs2);
    if (ve2 === -1) ve2 = json.indexOf('}', vs2);
    if (ve2 === -1) return json.substring(vs2);
    return json.substring(vs2, ve2).replace(/"/g, '').replace(/\\s/g, '');
}

var action = getVal(raw, 'action');
var sn = getVal(raw, 'sn');
var vc = getVal(raw, 'vc');
var ac = getVal(raw, 'ac');

function out(type, msg) {
    var safe = String(msg).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"').replace(/\\r/g, '').replace(/\\n/g, ' ');
    WScript.StdOut.WriteLine('{"type":"' + type + '","message":"' + safe + '"}');
}

if (action === 'check') {
    try {
        var chk = new ActiveXObject("FlexCodeSDK.FinFPReg");
        WScript.StdOut.WriteLine('{"type":"ready","connected":true}');
    } catch(e) { out('error', 'SDK not registered: ' + e.message); }
    WScript.Quit();
}

if (action === 'enroll') {
    try {
        out('log', 'Connecting Events via JScript...');
        var reg = new ActiveXObject("FlexCodeSDK.FinFPReg");
        WScript.ConnectObject(reg, "reg_");
        
        reg.DeviceInfo(sn, vc, ac);
        // CRITICAL BUG FIX: Must pass "MySecretKey" exactly, rather than the raw AC.
        reg.FPRegistrationStart("MySecretKey");
        out('log', 'Registration started. Please place your finger on the scanner.');
        
        while (true) { WScript.Sleep(50); }
    } catch(e) { out('error', 'Enroll failed: ' + e.message); WScript.Quit(1); }
}

if (action === 'verify') {
    try {
        out('log', 'Connecting Events via JScript...');
        var ver = new ActiveXObject("FlexCodeSDK.FinFPVer");
        WScript.ConnectObject(ver, "ver_");
        
        ver.DeviceInfo(sn, vc, ac);
        
        var tIdx = raw.indexOf('"templates"');
        if (tIdx !== -1) {
            var arrStart = raw.indexOf('[', tIdx);
            var arrEnd = raw.lastIndexOf(']');
            if (arrStart !== -1 && arrEnd !== -1) {
                var arrStr = raw.substring(arrStart + 1, arrEnd);
                var items = arrStr.split('},');
                var loadCount = 0;
                for (var i = 0; i < items.length; i++) {
                    var id = getVal(items[i], 'employee_id');
                    var data = getVal(items[i], 'template_data');
                    if (id !== '' && data !== '') {
                        try {
                            // CRITICAL BUG FIX: Key must exactly match "MySecretKey" used in Enroll!
                            ver.FPLoad(id, 0, data, "MySecretKey"); 
                            loadCount++;
                        } catch(e2) { out('log', 'Warning: Failed to load temp ' + id); }
                    }
                }
                out('log', 'Loaded ' + loadCount + ' templates into scanner memory');
            }
        }
        
        ver.FPVerificationStart();
        out('log', 'Verification started. Please scan your finger.');
        
        while (true) { WScript.Sleep(50); }
    } catch(e) { out('error', 'Verify failed: ' + e.message); WScript.Quit(1); }
}

function reg_FPSamplesNeeded(Samples) {
    WScript.StdOut.WriteLine('{"type":"progress","samplesRemaining":' + Samples + ',"message":"Scan berhasil, sisa ' + Samples + '"}');
}

function reg_FPRegistrationTemplate(FPTemplate) {
    out('log', 'Template captured successfully! (Length=' + FPTemplate.length + ')');
    template = FPTemplate;
    WScript.StdOut.WriteLine('{"type":"enrolled","templateBase64":"' + FPTemplate + '"}');
    WScript.Quit();
}

function reg_FPRegistrationStatus(Status) {
    out('log', 'Registration COM state updated: ' + Status);
    if (Status == 11) {
        out('error', 'SDK Failure: Fingerprint already registered or identical duplicate. Status 11');
        WScript.StdOut.WriteLine('{"type":"error","message":"Jari sudah terdaftar!"}');
        WScript.Quit(1);
    }
}

function reg_FPRegistrationImage() {}

function ver_FPVerificationID(ID, FingerNr) {
    out('log', 'Match: Verified ID=' + ID);
    matchedId = ID;
    WScript.StdOut.WriteLine('{"type":"identified","employeeId":"' + ID + '"}');
    WScript.Quit();
}

function ver_FPVerificationStatus(Status) {
    out('log', 'Verification COM state updated: ' + Status);
    if (Status == 6) {
        out('log', 'Status 6: Scan finished/stopped.');
    }
}

function ver_FPVerificationImage() {}
`.trim();

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

function getBridgeScriptPath(): string {
  const tmpScript = path.join(os.tmpdir(), 'marviano_fp_wsh_bridge.js');
  fs.writeFileSync(tmpScript, BRIDGE_JS_SOURCE, 'utf8');
  return tmpScript;
}

function runBridge(
  command: Record<string, any>,
  onProgress?: (obj: any) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const runId = Date.now() + "_" + Math.floor(Math.random() * 1000);
      const tmpDir = os.tmpdir();
      const cmdFile = path.join(tmpDir, 'marviano_fp_cmd_' + runId + '.json');
      const scriptPath = getBridgeScriptPath();

      fs.writeFileSync(cmdFile, JSON.stringify(command), 'utf8');

      console.log('[FP Bridge] Executing WSH JScript Engine:', CSCRIPT_32);
      const proc = spawn(CSCRIPT_32, ['//NoLogo', '//E:JScript', scriptPath, cmdFile]);
      
      let lastResult: any = null;

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split(/\\r?\\n/).filter((l: string) => l.trim().length > 0);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'progress') {
              onProgress?.(obj);
            } else if (obj.type === 'log') {
              console.log('[FP Bridge DEBUG]', obj.message);
            } else if (obj.type === 'error') {
              lastResult = obj; // store fatal error
            } else {
              lastResult = obj;
            }
          } catch(e) {
            console.log('[FP Bridge RAW]', line);
          }
        }
      });

      proc.stderr.on('data', (data) => console.error('[FP Bridge ERR]', data.toString()));

      proc.on('close', (code) => {
        try { if (fs.existsSync(cmdFile)) fs.unlinkSync(cmdFile); } catch(e){}
        if (lastResult && lastResult.type !== 'error') {
          resolve(lastResult);
        } else {
          reject({
            code: 'CAPTURE_FAILED',
            message: lastResult?.message || ('Bridge script exited with status ' + code)
          });
        }
      });
    } catch (err: any) {
      reject({ code: 'NO_SDK', message: err.message });
    }
  });
}

// --- Public APIs ---
export async function checkReaderConnected(): Promise<{ connected: boolean; message: string }> {
  try {
    const res = await runBridge({ action: 'check', sn: _sn, vc: _vc, ac: _ac });
    return { connected: res.connected === true, message: 'WSH SDK Connected' };
  } catch (err: any) {
    return { connected: false, message: err.message || String(err) };
  }
}

export async function enrollFingerprint(
  employeeId: number,
  onProgress?: OnProgress
): Promise<EnrollResult> {
  if (!_sn || !_vc || !_ac) throw ({ code: 'INVALID_CREDENTIALS', message: 'Credential belum diatur.' } as FpError);
  const res = await runBridge({ action: 'enroll', sn: _sn, vc: _vc, ac: _ac, employeeId }, (obj) => {
    if (obj.type === 'progress' && onProgress) {
      onProgress({ type: 'sample_captured', message: obj.message || 'Scanning...', samplesRemaining: obj.samplesRemaining });
    }
  });
  if (res.type === 'enrolled') return { templateBase64: res.templateBase64, quality: 100 };
  throw ({ code: 'ENROLL_FAILED', message: res.message || 'Enrollment failed' } as FpError);
}

export async function identifyFingerprint(
  storedTemplates: StoredTemplate[],
  onProgress?: OnProgress
): Promise<IdentifyResult> {
  if (!_sn || !_vc || !_ac) throw ({ code: 'INVALID_CREDENTIALS', message: 'Credential belum diatur.' } as FpError);
  const res = await runBridge({ action: 'verify', sn: _sn, vc: _vc, ac: _ac, templates: storedTemplates }, (obj) => {
    if (obj.type === 'progress' && onProgress) {
      onProgress({ type: 'sample_captured', message: obj.message || 'Identifying...', samplesRemaining: 0 });
    }
  });
  if (res.type === 'identified') return { employeeId: parseInt(String(res.employeeId), 10), score: 100 };
  throw ({ code: 'IDENTIFY_FAILED', message: res.message || 'No match found' } as FpError);
}
