using System;
using System.Collections.Generic;
using System.IO;
using System.Windows.Forms;
using FlexCodeSDK;

namespace Marviano
{
    class BridgeForm : Form
    {
        private string _action;
        private string _sn, _vc, _ac;
        private List<string[]> _templates = new List<string[]>();

        public BridgeForm(string jsonPath)
        {
            this.Text = "Marviano FP Bridge";
            this.Width = 1; this.Height = 1;
            this.ShowInTaskbar = false;
            this.WindowState = FormWindowState.Minimized;
            this.FormBorderStyle = FormBorderStyle.FixedToolWindow;

            try
            {
                string raw = File.ReadAllText(jsonPath);
                _action = GetJsonVal(raw, "action");
                _sn = GetJsonVal(raw, "sn");
                _vc = GetJsonVal(raw, "vc");
                _ac = GetJsonVal(raw, "ac");

                if (_action == "verify")
                {
                    if (raw.Contains("\"templates\""))
                    {
                        string tPart = raw.Substring(raw.IndexOf("\"templates\""));
                        int start = tPart.IndexOf("[");
                        int end = tPart.LastIndexOf("]");
                        if (start != -1 && end != -1)
                        {
                            string tArray = tPart.Substring(start + 1, end - start - 1);
                            string[] items = tArray.Split(new string[] { "}," }, StringSplitOptions.None);
                            foreach (var item in items)
                            {
                                string id = GetJsonVal(item, "employee_id");
                                string data = GetJsonVal(item, "template_data");
                                if (!string.IsNullOrEmpty(id) && !string.IsNullOrEmpty(data))
                                {
                                    _templates.Add(new string[] { id, data });
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Out("error", "Config parse error: " + ex.Message);
                Application.Exit();
            }
        }

        private string GetJsonVal(string json, string key)
        {
            string pattern = "\"" + key + "\":\"";
            int start = json.IndexOf(pattern);
            if (start == -1)
            {
                pattern = "\"" + key + "\":";
                start = json.IndexOf(pattern);
                if (start == -1) return "";
                int vstart = start + pattern.Length;
                int vend = json.IndexOf(",", vstart);
                if (vend == -1) vend = json.IndexOf("}", vstart);
                if (vend == -1) return json.Substring(vstart).Trim().Replace("\"", "");
                return json.Substring(vstart, vend - vstart).Trim().Replace("\"", "");
            }
            else
            {
                int vstart = start + pattern.Length;
                int vend = json.IndexOf("\"", vstart);
                if (vend == -1) return "";
                return json.Substring(vstart, vend - vstart);
            }
        }

        private void Out(string type, string message)
        {
            // Escape special chars in message for JSON
            string safe = message.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
            Console.WriteLine("{\"type\":\"" + type + "\",\"message\":\"" + safe + "\"}");
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            try
            {
                if (_action == "enroll") Enroll();
                else if (_action == "verify") Verify();
                else if (_action == "check") Check();
                else Application.Exit();
            }
            catch (Exception ex)
            {
                Out("error", ex.Message);
                Application.Exit();
            }
        }

        private void Check()
        {
            try
            {
                Type t = Type.GetTypeFromProgID("FlexCodeSDK.FinFPReg");
                if (t != null)
                    Console.WriteLine("{\"type\":\"ready\",\"connected\":true}");
                else
                    Out("error", "SDK Not Registered");
            }
            catch
            {
                Out("error", "Check Failed");
            }
            Application.Exit();
        }

        private void Enroll()
        {
            Out("log", "Starting enrollment with COM events...");

            FinFPReg reg = new FinFPReg();
            string capturedTemplate = "";

            // Subscribe to COM events (the correct way per SDK sample)
            reg.FPSamplesNeeded += delegate(short Samples)
            {
                Console.WriteLine("{\"type\":\"progress\",\"samplesRemaining\":" + Samples + ",\"message\":\"Scan berhasil, sisa " + Samples + "\"}");
            };

            reg.FPRegistrationTemplate += delegate(string FPTemplate)
            {
                Out("log", "Template captured, length=" + FPTemplate.Length);
                capturedTemplate = FPTemplate;
            };

            reg.FPRegistrationStatus += delegate(RegistrationStatus Status)
            {
                Out("log", "Registration status: " + Status.ToString());
                if (Status == RegistrationStatus.r_OK)
                {
                    // Escape template for JSON (it's base64, should be safe, but just in case)
                    string safeTemplate = capturedTemplate.Replace("\\", "\\\\").Replace("\"", "\\\"");
                    Console.WriteLine("{\"type\":\"enrolled\",\"templateBase64\":\"" + safeTemplate + "\"}");
                    Application.Exit();
                }
            };

            // Initialize device
            Out("log", "Calling AddDeviceInfo: sn=" + _sn);
            reg.AddDeviceInfo(_sn, _vc, _ac);

            // Start registration
            Out("log", "Calling FPRegistrationStart...");
            reg.FPRegistrationStart(_ac);
            Out("log", "Registration started. Place your finger on the scanner.");
        }

        private void Verify()
        {
            Out("log", "Starting verification with COM events...");

            FinFPVer ver = new FinFPVer();
            string matchedId = "";

            // Subscribe to COM events
            ver.FPVerificationID += delegate(string ID, FingerNumber FingerNr)
            {
                Out("log", "Finger matched ID: " + ID);
                matchedId = ID;
            };

            ver.FPVerificationStatus += delegate(VerificationStatus Status)
            {
                Out("log", "Verification status: " + Status.ToString());
                if (Status == VerificationStatus.v_OK)
                {
                    Console.WriteLine("{\"type\":\"identified\",\"employeeId\":\"" + matchedId + "\"}");
                    Application.Exit();
                }
                else if (Status == VerificationStatus.v_NotMatch)
                {
                    Out("error", "Fingerprint tidak dikenali");
                    // Don't exit - keep scanning
                }
            };

            // Initialize device
            Out("log", "Calling AddDeviceInfo...");
            ver.AddDeviceInfo(_sn, _vc, _ac);

            // Load templates
            Out("log", "Loading " + _templates.Count + " templates...");
            foreach (var tpl in _templates)
            {
                try
                {
                    ver.FPLoad(tpl[0], 0, tpl[1], "SalesPulseFP" + tpl[0]);
                }
                catch (Exception ex)
                {
                    Out("log", "Warning: Failed to load template for ID " + tpl[0] + ": " + ex.Message);
                }
            }

            // Start verification
            Out("log", "Calling FPVerificationStart...");
            ver.FPVerificationStart();
            Out("log", "Verification started. Place your finger on the scanner.");
        }

        [STAThread]
        static void Main(string[] args)
        {
            if (args.Length < 1) return;
            Application.Run(new BridgeForm(args[0]));
        }
    }
}
