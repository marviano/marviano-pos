unit UnitIdentification;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, StdCtrls, ExtCtrls, ComCtrls, OleServer, ClipBrd,FlexCodeSDK;

type
  TFormIdentification = class(TForm)
    Edit1: TEdit;
    Edit2: TEdit;
    Edit3: TEdit;
    Label1: TLabel;
    Label2: TLabel;
    Label3: TLabel;
    button1: TButton;
    Label6: TLabel;
    GroupBox1: TGroupBox;
    Button2: TButton;
    Button3: TButton;
    Button4: TButton;
    Label4: TLabel;
    Edit4: TEdit;
    ComboBox1: TComboBox;
    Label5: TLabel;
    Label7: TLabel;
    Button5: TButton;
    Button6: TButton;
    Button7: TButton;
    CheckBox1: TCheckBox;
    Button8: TButton;
    Panel1: TPanel;
    Image1: TImage;
    Label8: TLabel;
    RichEdit1: TRichEdit;
    FinFPVer1: TFinFPVer;
    RichEdit2: TRichEdit;
    RichEdit3: TRichEdit;
    procedure FormCreate(Sender: TObject);
    procedure button1Click(Sender: TObject);
    procedure Button4Click(Sender: TObject);
    procedure Button2Click(Sender: TObject);
    procedure Button5Click(Sender: TObject);
    procedure Button8Click(Sender: TObject);
    procedure Button3Click(Sender: TObject);
    procedure Button6Click(Sender: TObject);
    procedure Button7Click(Sender: TObject);
    procedure FormClose(Sender: TObject; var Action: TCloseAction);
    procedure FinFPVer1FPVerificationID(ASender: TObject;
      const ID: WideString; FingerNr: Integer);
    procedure FinFPVer1FPVerificationImage(Sender: TObject);
    procedure FinFPVer1FPVerificationStatus(ASender: TObject;
      Status: Integer);
  private
    { Private declarations }
  public
    { Public declarations }
  end;

var
  FormIdentification: TFormIdentification;

implementation

{$R *.dfm}

procedure TFormIdentification.FormCreate(Sender: TObject);
begin
  Image1.Canvas.Create;
  FinFPVer1.PictureSamplePath := ExtractFilePath(Application.ExeName) + '\FPTemp.BMP';
  FinFPVer1.PictureSampleHeight := 1635;
  FinFPVer1.PictureSampleWidth := 1335;
end;

procedure TFormIdentification.button1Click(Sender: TObject);
begin
  if (FinFPVer1.AddDeviceInfo(Edit1.Text,Edit2.text,Edit3.text)) then
  begin
    ShowMessage('Add Device Success!');
    Edit1.text:='';
    Edit2.text:='';
    Edit3.text:='';
    Edit1.Focused;
  end
  else ShowMessage('Add Device Fail!');
end;

procedure TFormIdentification.Button2Click(Sender: TObject);
begin
  RichEdit1.PasteFromClipboard;
end;

procedure TFormIdentification.Button4Click(Sender: TObject);
begin
  RichEdit2.PasteFromClipboard;
end;

procedure TFormIdentification.Button5Click(Sender: TObject);
begin
  if (FinFPVer1.FPLoad(Edit4.Text,ComboBox1.ItemIndex,RichEdit2.Text,'MySecretKey')) Then
    ShowMessage('Success. Total templates : ' + inttostr(FinFPVer1.GetFPCount) + ' Add Template')
  else
    ShowMessage('Add Template Fail!');
end;

procedure TFormIdentification.Button8Click(Sender: TObject);
begin
  if (CheckBox1.Checked=true) Then
    FinFPVer1.WorkingInBackground(true)
  else
    FinFPVer1.WorkingInBackground(false);

  if (button8.Caption='&Start Verify') Then
  begin
    RichEdit3.Clear;
    Button8.Caption := '&Stop Verify';
    FinFPVer1.FPVerificationStart('');
  end
  else
  begin
    button8.Caption := '&Start Verify';
    FinFPVer1.FPVerificationStop();
  end;
end;

procedure TFormIdentification.Button3Click(Sender: TObject);
var
  i : integer;
begin
  for i:=1 to 1999 do
    FinFPVer1.FPLoad(inttostr(i),ComboBox1.ItemIndex,RichEdit1.Text,'MySecretKey');
  edit4.Text:='2000';
  edit4.Enabled:=false;
  ShowMessage('Done! Please add another template');
end;

procedure TFormIdentification.Button6Click(Sender: TObject);
begin
 if (FinFPVer1.FPUnload(Edit4.text,ComboBox1.ItemIndex)) Then
  ShowMessage('Success. Total templates : ' + inttostr(FinFPVer1.GetFPCount) + ' Unload Template')
 else
  ShowMessage('Unload Template fail!');
end;

procedure TFormIdentification.Button7Click(Sender: TObject);
begin
  FinFPVer1.FPListClear;
end;

procedure TFormIdentification.FormClose(Sender: TObject;
  var Action: TCloseAction);
begin
  FinFPVer1.FPVerificationStop();
end;

procedure TFormIdentification.FinFPVer1FPVerificationID(ASender: TObject;
  const ID: WideString; FingerNr: Integer);
begin
  RichEdit3.lines.add('ID = ' + ID + ', FingerNr = ' + inttostr(FingerNr));
end;

procedure TFormIdentification.FinFPVer1FPVerificationImage(
  Sender: TObject);
begin
  Image1.Picture.LoadFromFile(ExtractFilePath(Application.ExeName) + '\FPTemp.BMP');
end;

procedure TFormIdentification.FinFPVer1FPVerificationStatus(
  ASender: TObject; Status: Integer);
begin
  case Status of
    0  :  begin
            RichEdit3.lines.add('Not match!');
          end;
    1  :  begin
            RichEdit3.lines.add('Match!');
          end;
    2   : begin
            RichEdit3.lines.add('Multiple match!');
          end;
    3  :  begin
            RichEdit3.lines.add('Verification fail!');
          end;
    7   : begin
            RichEdit3.lines.add('Please connect the device to USB port!');
            Button8.Caption := '&Start Verify';
          end;
    8  :  begin
            RichEdit3.lines.add('Poor image quality!');
          end;
    9   : begin
            RichEdit3.lines.add('Activation/verification code is incorrect!');
            Button8.Caption := '&Start Verify';
          end;
    11  : begin
            RichEdit3.lines.add('&Stop Verify!');
            Button8.Caption := '&Start Verify';
          end;
    15  : begin
            RichEdit3.lines.add('Finger touch!');
          end;
    16  : begin
            RichEdit3.lines.add('Max 2000 templates!');
          end;
    17  : begin
            RichEdit3.lines.add('Max 10 Devices!');
          end;
    18  : begin
            RichEdit3.lines.add('Please add some template!');
            Button8.Caption := '&Start Verify';
          end;          
  end;

end;

end.
