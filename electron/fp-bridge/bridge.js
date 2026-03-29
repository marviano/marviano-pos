// Marviano FP Bridge - Windows Script Host JScript
// Interfaces with FlexCodeSDK COM events natively (no compilation needed)
// Usage: C:\Windows\SysWOW64\cscript.exe //NoLogo //E:JScript bridge.js config.json
//
// This bridge uses WScript.ConnectObject to subscribe to COM events,
// which is the correct way to interact with the FlexCode SDK.
// The SDK fires events (FPRegistrationTemplate, FPVerificationID, etc.)
// rather than exposing pollable properties.

var template = '';
var matchedId = '';

// Read configuration from JSON file
var fso = new ActiveXObject("Scripting.FileSystemObject");
var f = fso.OpenTextFile(WScript.Arguments(0), 1);
var raw = f.ReadAll();
f.Close();

// Simple JSON value extractor (WSH JScript has no JSON.parse)
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
    return json.substring(vs2, ve2).replace(/"/g, '').replace(/\s/g, '');
}

var action = getVal(raw, 'action');
var sn = getVal(raw, 'sn');
var vc = getVal(raw, 'vc');
var ac = getVal(raw, 'ac');

// Helper to output JSON messages to stdout
function out(type, msg) {
    var safe = String(msg).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, ' ');
    WScript.StdOut.WriteLine('{"type":"' + type + '","message":"' + safe + '"}');
}

// ==================== CHECK ACTION ====================
if (action === 'check') {
    try {
        var chk = new ActiveXObject("FlexCodeSDK.FinFPReg");
        WScript.StdOut.WriteLine('{"type":"ready","connected":true}');
    } catch(e) {
        out('error', 'SDK not registered: ' + e.message);
    }
    WScript.Quit();
}

// ==================== ENROLL ACTION ====================
if (action === 'enroll') {
    try {
        var reg = new ActiveXObject("FlexCodeSDK.FinFPReg");
        WScript.ConnectObject(reg, "reg_");
        reg.DeviceInfo(sn, vc, ac);
        reg.FPRegistrationStart(ac);
        out('log', 'Registration started. Place finger on scanner.');
        // Message pump loop - keeps process alive to receive COM events
        while (true) { WScript.Sleep(100); }
    } catch(e) {
        out('error', 'Enroll failed: ' + e.message);
        WScript.Quit(1);
    }
}

// ==================== VERIFY ACTION ====================
if (action === 'verify') {
    try {
        var ver = new ActiveXObject("FlexCodeSDK.FinFPVer");
        WScript.ConnectObject(ver, "ver_");
        ver.DeviceInfo(sn, vc, ac);

        // Parse and load templates from JSON
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
                            ver.FPLoad(id, 0, data, 'SalesPulseFP' + id);
                            loadCount++;
                        } catch(e2) {
                            out('log', 'Warning: Failed to load template ' + id + ': ' + e2.message);
                        }
                    }
                }
                out('log', 'Loaded ' + loadCount + ' templates');
            }
        }

        ver.FPVerificationStart();
        out('log', 'Verification started. Place finger on scanner.');
        while (true) { WScript.Sleep(100); }
    } catch(e) {
        out('error', 'Verify failed: ' + e.message);
        WScript.Quit(1);
    }
}

// ==================== REGISTRATION EVENT HANDLERS ====================
// Event prefix: "reg_" (matching WScript.ConnectObject prefix)

function reg_FPSamplesNeeded(Samples) {
    WScript.StdOut.WriteLine('{"type":"progress","samplesRemaining":' + Samples + ',"message":"Scan berhasil, sisa ' + Samples + '"}');
}

function reg_FPRegistrationTemplate(FPTemplate) {
    // This event fires when template data is ready (always means success)
    out('log', 'Template captured, length=' + FPTemplate.length);
    template = FPTemplate;
    // Output as enrolled - the template event IS the success signal
    WScript.StdOut.WriteLine('{"type":"enrolled","templateBase64":"' + FPTemplate + '"}');
    WScript.Quit();
}

function reg_FPRegistrationStatus(Status) {
    // RegistrationStatus enum values from SDK:
    // r_OK, r_RegistrationFailed, r_NoDevice, r_PoorImageQuality,
    // r_ActivationIncorrect, r_RegistrationCaptureStart, r_RegistrationCaptureStop
    out('log', 'Registration status code: ' + Status);
}

function reg_FPRegistrationImage() {
    // Fingerprint image captured - not needed for our use case
}

// ==================== VERIFICATION EVENT HANDLERS ====================
// Event prefix: "ver_" (matching WScript.ConnectObject prefix)

function ver_FPVerificationID(ID, FingerNr) {
    // This event fires when a fingerprint matches a loaded template
    out('log', 'Match found: ID=' + ID + ', Finger=' + FingerNr);
    matchedId = ID;
    // Output immediately - FPVerificationID is the definitive match signal
    WScript.StdOut.WriteLine('{"type":"identified","employeeId":"' + ID + '"}');
    WScript.Quit();
}

function ver_FPVerificationStatus(Status) {
    // VerificationStatus enum values from SDK:
    // v_OK, v_NotMatch, v_ActivationIncorrect, v_FPListEmpty,
    // v_FPListFull, v_FPDevFull, v_MultiplelMatch, v_NoDevice,
    // v_PoorImageQuality, v_VerificationFailed,
    // v_VerifyCaptureFingerTouch, v_VerifyCaptureStop
    out('log', 'Verification status code: ' + Status);
    // Don't exit on non-matches - keep scanning
}

function ver_FPVerificationImage() {
    // Fingerprint image captured - not needed for our use case
}
