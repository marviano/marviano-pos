using System;
using System.IO;
using System.Windows.Forms;

namespace MarvianoFpBridge
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            
            if (args.Length == 0 || !File.Exists(args[0]))
            {
                Console.WriteLine("{\"type\":\"error\",\"message\":\"Missing config path parameter\"}");
                return;
            }

            try
            {
                Application.Run(new BridgeForm(args[0]));
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"type\":\"error\",\"message\":\"" + ex.Message.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}");
            }
        }
    }
}
