Option Explicit On
Imports System.IO
Public Class Form4

    Dim WithEvents FPCap As FlexCodeSDK.FinFPImg

    Private Sub Form4_Disposed(ByVal sender As Object, ByVal e As System.EventArgs) Handles Me.Disposed
        FPCap.FPImageStop()
    End Sub

    Private Sub Form4_Load(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles MyBase.Load
        FPCap = New FlexCodeSDK.FinFPImg
        FPCap.PictureSamplePath = My.Application.Info.DirectoryPath & "\Sample.BMP"
        TextBox4.Text = My.Application.Info.DirectoryPath & "\Sample.BMP"
        FPCap.PictureSampleHeight = Microsoft.VisualBasic.Compatibility.VB6.PixelsToTwipsY(PictureBox1.Height)
        FPCap.PictureSampleWidth = Microsoft.VisualBasic.Compatibility.VB6.PixelsToTwipsY(PictureBox1.Width)
    End Sub

    Private Sub Button2_Click(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles Button2.Click
        If Button2.Text = "Start capture image" Then
            Button2.Text = "Stop capture image"
            FPCap.DeviceInfo(TextBox1.Text, TextBox2.Text, TextBox3.Text)
            FPCap.FPImageStart()
        Else
            Button2.Text = "Start capture image"
            FPCap.FPImageStop()
        End If
    End Sub

    Private Sub FPCap_FPImage() Handles FPCap.FPImage
        Dim imgFile As System.IO.FileStream = New System.IO.FileStream(TextBox4.Text, System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.ReadWrite)
        Dim fileBytes(imgFile.Length) As Byte
        imgFile.Read(fileBytes, 0, fileBytes.Length)
        imgFile.Close()
        Dim ms As System.IO.MemoryStream = New MemoryStream(fileBytes)
        PictureBox1.Image = Image.FromStream(ms)
    End Sub

    Private Sub FPCap_FPImageStatus(ByVal Status As FlexCodeSDK.FPImageStatus) Handles FPCap.FPImageStatus
        Select Case Status
            Case FlexCodeSDK.FPImageStatus.Fi_ActivationIncorrect
                MsgBox("Activation / verification code is incorrent or not set")
                Button2.Text = "Start capture image"
            Case FlexCodeSDK.FPImageStatus.Fi_NoDevice
                MsgBox("Please connect the device to USB port or Add a device")
                Button2.Text = "Start capture image"
            Case FlexCodeSDK.FPImageStatus.Fi_FPImageStop
                MsgBox("Stop Scan")
                Button2.Text = "Start capture image"
        End Select
    End Sub

    Private Sub Button3_Click(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles Button3.Click
        FPCap.PictureSamplePath = TextBox4.Text
    End Sub
End Class