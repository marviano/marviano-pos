using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Reflection;
using System.Text;
using System.IO;

// Custom simple JSON parser to keep zero dependencies
namespace Marviano
{
    class BridgeForm : Form
    {
        private object _sdk;
        private string _action;
        private string _sn, _vc, _ac;
        private List<string[]> _templates = new List<string[]>();

        public BridgeForm(string jsonPath)
        {
            this.WindowState = FormWindowState.Minimized;
            this.ShowInTaskbar = false;

            try {
                // Manually parse the simple JSON structure to avoid dependencies
                string raw = File.ReadAllText(jsonPath);
                _action = GetJsonVal(raw, "action");
                _sn = GetJsonVal(raw, "sn");
                _vc = GetJsonVal(raw, "vc");
                _ac = GetJsonVal(raw, "ac");

                if (_action == "verify") {
                    // Extract templates: [{"employee_id":1, "template_data":"..."}, ...]
                    // This is a manual parse of a JSON array of objects
                    string tPart = raw.Substring(raw.IndexOf("\"templates\""));
                    int start = tPart.IndexOf("[");
                    int end = tPart.LastIndexOf("]");
                    string tArray = tPart.Substring(start + 1, end - start - 1);
                    string[] items = tArray.Split(new string[] { "}," }, StringSplitOptions.None);
                    foreach (var item in items) {
                        string id = GetJsonVal(item, "employee_id");
                        string data = GetJsonVal(item, "template_data");
                        if (!string.IsNullOrEmpty(id) && !string.IsNullOrEmpty(data)) {
                            _templates.Add(new string[] { id, data });
                        }
                    }
                }
            } catch (Exception ex) {
                Console.WriteLine("{\"type\":\"error\",\"message\":\"Config parse error: " + ex.Message + "\"}");
                Application.Exit();
            }
        }

        private string GetJsonVal(string json, string key) {
            string pattern = "\"" + key + "\":\"";
            int start = json.IndexOf(pattern);
            if (start == -1) {
                pattern = "\"" + key + "\":"; // Try numeric
                start = json.IndexOf(pattern);
                if (start == -1) return "";
                int vstart = start + pattern.Length;
                int vend = json.IndexOf(",", vstart);
                if (vend == -1) vend = json.IndexOf("}", vstart);
                if (vend == -1) return json.Substring(vstart).Trim().Replace("\"", "");
                return json.Substring(vstart, vend - vstart).Trim().Replace("\"", "");
            } else {
                int vstart = start + pattern.Length;
                int vend = json.IndexOf("\"", vstart);
                return json.Substring(vstart, vend - vstart);
            }
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            if (_action == "enroll") Enroll();
            else if (_action == "verify") Verify();
            else if (_action == "check") Check();
            else Application.Exit();
        }

        private void Check() {
            try {
                Type t = Type.GetTypeFromProgID("FlexCodeSDK.FinFPReg");
                if (t != null) Console.WriteLine("{\"type\":\"ready\",\"connected\":true}");
                else Console.WriteLine("{\"type\":\"error\",\"message\":\"SDK Not Registered\"}");
            } catch { Console.WriteLine("{\"type\":\"error\",\"message\":\"Check Failed\"}"); }
            Application.Exit();
        }

        private void Enroll()
        {
            try {
                Type t = Type.GetTypeFromProgID("FlexCodeSDK.FinFPReg");
                _sdk = Activator.CreateInstance(t);
                t.InvokeMember("AddDeviceInfo", BindingFlags.InvokeMethod, null, _sdk, new object[] { _sn, _vc, _ac });
                
                Timer poll = new Timer();
                poll.Interval = 200;
                poll.Tick += (s, ev) => {
                    int status = (int)t.InvokeMember("RegistrationStatus", BindingFlags.GetProperty, null, _sdk, null);
                    if (status == 0) {
                        string tmpl = (string)t.InvokeMember("FPRegistrationTemplate", BindingFlags.GetProperty, null, _sdk, null);
                        Console.WriteLine("{\"type\":\"enrolled\",\"templateBase64\":\"" + tmpl + "\"}");
                        Application.Exit();
                    } else if (status != 10 && status != -1) {
                         if (status == 7 || status == 3 || status == 9) {
                             Console.WriteLine("{\"type\":\"error\",\"message\":\"Status " + status + "\"}");
                             Application.Exit();
                         }
                    }
                };
                poll.Start();

                t.InvokeMember("FPRegistrationStart", BindingFlags.InvokeMethod, null, _sdk, new object[] { _ac });
                Console.WriteLine("{\"type\":\"progress\",\"samplesRemaining\":4,\"message\":\"Siap scan...\"}");
            } catch (Exception ex) { Console.WriteLine("{\"type\":\"error\",\"message\":\"" + ex.Message + "\"}"); Application.Exit(); }
        }

        private void Verify()
        {
            try {
                Type t = Type.GetTypeFromProgID("FlexCodeSDK.FinFPVer");
                _sdk = Activator.CreateInstance(t);
                t.InvokeMember("AddDeviceInfo", BindingFlags.InvokeMethod, null, _sdk, new object[] { _sn, _vc, _ac });

                foreach (var tpl in _templates) {
                    t.InvokeMember("FPLoad", BindingFlags.InvokeMethod, null, _sdk, new object[] { tpl[0], 0, tpl[1], "SalesPulseFP" + tpl[0] });
                }

                Timer poll = new Timer();
                poll.Interval = 200;
                string lastId = "";
                poll.Tick += (s, ev) => {
                    int status = (int)t.InvokeMember("VerificationStatus", BindingFlags.GetProperty, null, _sdk, null);
                    if (status == 1 || status == 2) { // 1 = Match, 2 = Perfect Match
                        string id = (string)t.InvokeMember("FPVerificationID", BindingFlags.GetProperty, null, _sdk, null);
                        Console.WriteLine("{\"type\":\"identified\",\"employeeId\":\"" + id + "\"}");
                        Application.Exit();
                    } else if (status == 15) { // Finger touch
                         Console.WriteLine("{\"type\":\"progress\",\"message\":\"Memproses...\"}");
                    } else if (status == 0 && status != -1) {
                         // Some SDKs fire status 0 for "No Match"
                    }
                };
                poll.Start();

                t.InvokeMember("FPVerificationStart", BindingFlags.InvokeMethod, null, _sdk, null);
                Console.WriteLine("{\"type\":\"progress\",\"message\":\"Tempelkan jari...\"}");
            } catch (Exception ex) { Console.WriteLine("{\"type\":\"error\",\"message\":\"" + ex.Message + "\"}"); Application.Exit(); }
        }

        [STAThread]
        static void Main(string[] args)
        {
            if (args.Length < 1) return;
            Application.Run(new BridgeForm(args[0]));
        }
    }
}
