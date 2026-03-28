Option Explicit On
Imports System.IO

Public Class Form2
    Dim WithEvents FPReg As New FlexCodeSDK.FinFPReg

    Private Sub Form2_Load(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles MyBase.Load
        FPReg = New FlexCodeSDK.FinFPReg
        FPReg.PictureSamplePath = My.Application.Info.DirectoryPath & "\FPTemp.BMP"
        FPReg.PictureSampleHeight = Microsoft.VisualBasic.Compatibility.VB6.PixelsToTwipsY(PictureBox1.Height)
        FPReg.PictureSampleWidth = Microsoft.VisualBasic.Compatibility.VB6.PixelsToTwipsY(PictureBox1.Width)
    End Sub

    Private Sub Form2_Disposed(ByVal sender As Object, ByVal e As System.EventArgs) Handles Me.Disposed
        If Button1.Text <> "Registration" Then
            FPReg.FPRegistrationStop()
        End If
    End Sub

    Private Sub FPReg_FPRegistrationImage() Handles FPReg.FPRegistrationImage
        Dim imgFile As System.IO.FileStream = New System.IO.FileStream(My.Application.Info.DirectoryPath & "\FPTemp.BMP", System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.ReadWrite)
        Dim fileBytes(imgFile.Length) As Byte
        imgFile.Read(fileBytes, 0, fileBytes.Length)
        imgFile.Close()
        Dim ms As System.IO.MemoryStream = New MemoryStream(fileBytes)
        PictureBox1.Image = Image.FromStream(ms)
    End Sub

    Private Sub Button1_Click(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles Button1.Click
        If Button1.Text = "Registration" Then
            Button1.Text = "Cancel"
            FPReg.DeviceInfo(TextBox1.Text, TextBox2.Text, TextBox3.Text)
            FPReg.FPRegistrationStart("MySecretKey")
        Else
            Button1.Text = "Registration"
            FPReg.FPRegistrationStop()
        End If
    End Sub

    Private Sub FPReg_FPRegistrationStatus(ByVal Status As FlexCodeSDK.RegistrationStatus) Handles FPReg.FPRegistrationStatus
        Select Case Status
            Case FlexCodeSDK.RegistrationStatus.r_OK
                TextBox4.Text = TextBox4.Text & vbNewLine & "Registration Success"
                Button1.Text = "Registration"
            Case FlexCodeSDK.RegistrationStatus.r_ActivationIncorrect
                TextBox4.Text = TextBox4.Text & vbNewLine & "Activation / verification code is incorrent or not set"
                Button1.Text = "Registration"
            Case FlexCodeSDK.RegistrationStatus.r_NoDevice
                TextBox4.Text = TextBox4.Text & vbNewLine & "Please connect the device to USB port or Add a device"
                Button1.Text = "Registration"
            Case FlexCodeSDK.RegistrationStatus.r_PoorImageQuality
                TextBox4.Text = TextBox4.Text & vbNewLine & "Poor image quality"
            Case FlexCodeSDK.RegistrationStatus.r_RegistrationCaptureStart
                TextBox4.Text = TextBox4.Text & vbNewLine & "Registration capture start"
            Case FlexCodeSDK.RegistrationStatus.r_RegistrationCaptureStop
                TextBox4.Text = TextBox4.Text & vbNewLine & "Registration capture stop"
            Case FlexCodeSDK.RegistrationStatus.r_RegistrationFailed
                TextBox4.Text = TextBox4.Text & vbNewLine & "Registration failed"
                Button1.Text = "Registration"
        End Select
    End Sub

    Private Sub FPReg_FPRegistrationTemplate(ByVal FPTemplate As String) Handles FPReg.FPRegistrationTemplate
        TextBox5.Text = FPTemplate
    End Sub

    Private Sub FPReg_FPSamplesNeeded(ByVal Samples As Short) Handles FPReg.FPSamplesNeeded
        TextBox4.Text = TextBox4.Text & vbNewLine & "Samples Needed " & Samples
    End Sub

    Private Sub Button2_Click(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles Button2.Click
        Clipboard.SetText(TextBox5.Text)
    End Sub
End Class