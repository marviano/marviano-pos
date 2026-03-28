unit unitRegistration;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, StdCtrls, ExtCtrls, XPMan, OleServer, FlexCodeSDK, ComCtrls;

type
  TFormRegistration = class(TForm)
    Edit1: TEdit;
    Edit2: TEdit;
    Edit3: TEdit;
    Label1: TLabel;
    Label2: TLabel;
    Label3: TLabel;
    Label4: TLabel;
    Button1: TButton;
    Panel1: TPanel;
    Image1: TImage;
    Label5: TLabel;
    Button2: TButton;
    Label6: TLabel;
    FinFPReg1: TFinFPReg;
    memo2: TRichEdit;
    Memo1: TRichEdit;
    procedure FormCreate(Sender: TObject);
    procedure Button1Click(Sender: TObject);
    procedure FinFPReg1FPRegistrationStatus(ASender: TObject;
      Status: Integer);
    procedure FinFPReg1FPRegistrationTemplate(ASender: TObject;
      const FPTemplate: WideString);
    procedure FinFPReg1FPSamplesNeeded(ASender: TObject;
      Samples: Smallint);
    procedure FinFPReg1FPRegistrationImage(Sender: TObject);
    procedure Button2Click(Sender: TObject);
    procedure FormClose(Sender: TObject; var Action: TCloseAction);
  private
    { Private declarations }
  public
    { Public declarations }
  end;

var
  FormRegistration: TFormRegistration;

implementation

{$R *.dfm}

procedure TFormRegistration.FormCreate(Sender: TObject);
begin
  image1.Canvas.Create();
  FinFPReg1.PictureSamplePath := ExtractFilePath(Application.ExeName) + '\FPTemp.BMP';
  FinFPReg1.PictureSampleHeight := 1635;
  FinFPReg1.PictureSampleWidth := 1335;
end;

procedure TFormRegistration.Button1Click(Sender: TObject);
begin
  If (button1.Caption = '&Registration') Then
  begin
    FinFPReg1.DeviceInfo(Edit1.Text,Edit2.Text,Edit3.text);
    Button1.Caption := '&Cancel';
    FinFPReg1.FPRegistrationStart('MySecretKey');
  end
  else
  begin
    FinFPReg1.FPRegistrationStop;
    button1.Caption := '&Registration';
  end;
end;

procedure TFormRegistration.FinFPReg1FPRegistrationStatus(ASender: TObject;
  Status: Integer);
begin
  case Status of
    0 : begin
          button1.Caption := '&Registration';
          memo2.lines.add('Registration Success');
        end;
    3 : begin
          button1.Caption := '&Registration';
          memo2.lines.add('Registration Fail');
        end;
    7 : begin
          button1.Caption := '&Registration';
          memo2.lines.add('Please connect the device to USB port!');
        end;
    8 :  memo2.lines.add('Poor image quality!');
    9 :  memo2.lines.add('Activation/verification code is incorrent or not set!');
    10 : memo2.lines.add('Registration Start!');
    11 : memo2.lines.add('Registration Stop!');
  end;

end;

procedure TFormRegistration.FinFPReg1FPRegistrationTemplate(
  ASender: TObject; const FPTemplate: WideString);
begin
  memo1.Clear;
  memo1.lines.add(FPTemplate);
end;

procedure TFormRegistration.FinFPReg1FPSamplesNeeded(ASender: TObject;
  Samples: Smallint);
begin
  memo2.lines.add('Samples Needed ' + inttostr(Samples));
end;

procedure TFormRegistration.FinFPReg1FPRegistrationImage(Sender: TObject);
begin
  Image1.Picture.LoadFromFile(ExtractFilePath(Application.ExeName) + '\FPTemp.BMP');
end;

procedure TFormRegistration.Button2Click(Sender: TObject);
begin
  Memo1.SelectAll;
  Memo1.CopyToClipboard;
  ShowMessage('Template has copied to clipboard!');
end;

procedure TFormRegistration.FormClose(Sender: TObject;
  var Action: TCloseAction);
begin
  If (Button1.Caption <> 'Registration') Then
    FinFPReg1.FPRegistrationStop();

end;

end.
