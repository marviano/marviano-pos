using System;
using System.Reflection;
using System.Runtime.InteropServices;

class Program {
    static void Main() {
        try {
            Type t = Type.GetTypeFromProgID("FlexCodeSDK.FinFPReg");
            if (t == null) { Console.WriteLine("FinFPReg NOT found"); return; }
            object sdk = Activator.CreateInstance(t);
            Console.WriteLine("FinFPReg instantiated.");
            
            // Just try to call a method that we suspect
            try { t.InvokeMember("AddDeviceInfo", BindingFlags.InvokeMethod, null, sdk, new object[] { "1", "2", "3" }); }
            catch (Exception ex) { Console.WriteLine("AddDeviceInfo failed: " + ex.InnerException.Message); }
            
            try { t.InvokeMember("PictureSampleWidth", BindingFlags.GetProperty, null, sdk, null); Console.WriteLine("PictureSampleWidth exists."); }
            catch (Exception ex) { Console.WriteLine("PictureSampleWidth missing: " + ex.InnerException.Message); }
        } catch (Exception ex) {
            Console.WriteLine("Fatal: " + ex.Message);
        }
    }
}
