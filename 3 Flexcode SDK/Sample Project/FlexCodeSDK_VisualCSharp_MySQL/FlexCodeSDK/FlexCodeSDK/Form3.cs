using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Windows.Forms;
using FlexCodeSDK;
using MySql.Data.MySqlClient;

namespace WindowsFormsApplication1
{
    public partial class Form3 : Form
    {
        FlexCodeSDK.FinFPVer ver;
        String empid = "";
        MySqlConnection conn = null;

        public Form3()
        {
            InitializeComponent();
        }

        private void Form3_Load(object sender, EventArgs e)
        {
            //Initialize FlexCodeSDK for Verification
            //1. Initialize Event Handler
            ver = new FlexCodeSDK.FinFPVer();
            ver.FPVerificationID += new __FinFPVer_FPVerificationIDEventHandler(ver_FPVerificationID);
            ver.FPVerificationImage += new __FinFPVer_FPVerificationImageEventHandler(ver_FPVerificationImage);
            ver.FPVerificationStatus += new __FinFPVer_FPVerificationStatusEventHandler(ver_FPVerificationStatus);
           
            //2. Input the activation code
            ver.AddDeviceInfo("C700F001339", "7901D3C13E34109", "VPFAAB943C33362467D451A0");

            //3. Define fingerprint image
            ver.PictureSampleHeight = (short)(pictureBox1.Height * 15); //FlexCodeSDK use Twips. 1 pixel = 15 twips
            ver.PictureSampleWidth = (short)(pictureBox1.Width * 15); //FlexCodeSDK use Twips. 1 pixel = 15 twips
            ver.PictureSamplePath = AppDomain.CurrentDomain.BaseDirectory + "Finger.bmp";

            //4. Load templates from database to FlexCodeSDK
            string cs = "server=192.168.0.16;userid=VBNet;password=123456;database=FingerspotDB";
            conn = new MySqlConnection(cs);
            conn.Open();
            string sql = "SELECT EmpID, EmpTemplate FROM Emp_T";
            MySqlCommand cmd = new MySqlCommand(sql, conn);
            MySqlDataReader rdr = cmd.ExecuteReader();
            while (rdr.Read())
            {
               ver.FPLoad(rdr.GetString(0), 0, rdr.GetString(1), "MySecretKey" + rdr.GetString(0)); 
            }

            //5. Start verification process
            ver.FPVerificationStart();
        }

        void ver_FPVerificationStatus(VerificationStatus Status)
        {
           if (Status == VerificationStatus.v_OK)
           {
               textBox1.Text = textBox1.Text + "\r\n" + "ID : " + empid;
           }
           else if (Status == VerificationStatus.v_NotMatch)
           {
               textBox1.Text = textBox1.Text + "\r\n" + "Not recognized";
           }
        }

        void ver_FPVerificationImage()
        {
            pictureBox1.Load(AppDomain.CurrentDomain.BaseDirectory + "Finger.bmp");
        }

        void ver_FPVerificationID(string ID, FingerNumber FingerNr)
        {
            empid = ID;
        }
    }
}
