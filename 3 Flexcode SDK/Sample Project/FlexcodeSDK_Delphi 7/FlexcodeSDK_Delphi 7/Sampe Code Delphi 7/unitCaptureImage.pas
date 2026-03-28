unit unitCaptureImage;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, ExtCtrls, StdCtrls, OleServer, FlexCodeSDK;

type
  TFormCaptureImage = class(TForm)
    Label1: TLabel;
    Edit1: TEdit;
    Edit2: TEdit;
    Label2: TLabel;
    Edit3: TEdit;
    Label3: TLabel;
    Button1: TButton;
    Label6: TLabel;
    Panel1: TPanel;
    Image1: TImage;
    Label4: TLabel;
    Edit4: TEdit;
    Label5: TLabel;
    Button2: TButton;
    FinFPImg1: TFinFPImg;
    procedure Button1Click(Sender: TObject);
    procedure Button2Click(Sender: TObject);
    procedure FormCreate(Sender: TObject);
    procedure FormClose(Sender: TObject; var Action: TCloseAction);
    procedure FinFPImg1FPImage(Sender: TObject);
    procedure FinFPImg1FPImageStatus(ASender: TObject; Status: Integer);
  private
    { Private declarations }
  public
    { Public declarations }
  end;

var
  FormCaptureImage: TFormCaptureImage;

implementation

{$R *.dfm}

procedure TFormCaptureImage.Button1Click(Sender: TObject);
begin
  if (Button1.Caption='&Start Scan') Then
  begin
    button1.Caption:='&Stop Scan';
    FinFPImg1.DeviceInfo(Edit1.Text,Edit2.text,Edit3.Text);
    FinFPImg1.FPImageStart();
  end
  else
  begin
    Button1.Caption:='&Start Scan';
    FinFPImg1.FPImageStop();
  end;
end;

procedure TFormCaptureImage.Button2Click(Sender: TObject);
begin
  FinFPImg1.PictureSamplePath := Edit4.Text;
end;

procedure TFormCaptureImage.FormCreate(Sender: TObject);
begin
  image1.Canvas.Create();
  FinFPImg1.PictureSamplePath := ExtractFilePath(Application.ExeName) + '\FPTemp.BMP';
  FinFPImg1.PictureSampleHeight := 2120;
  FinFPImg1.PictureSampleWidth := 1640;
  edit4.Text:=ExtractFilePath(Application.ExeName) + 'FPTemp.BMP';
end;

procedure TFormCaptureImage.FormClose(Sender: TObject;
  var Action: TCloseAction);
begin
  FinFPImg1.FPImageStop();
end;

procedure TFormCaptureImage.FinFPImg1FPImage(Sender: TObject);
begin
    Image1.Picture.LoadFromFile(Edit4.text);
end;

procedure TFormCaptureImage.FinFPImg1FPImageStatus(ASender: TObject;
  Status: Integer);
begin
  case Status of
    9  :  begin
            ShowMessage('Activation/verification code is incorrent or not set!');
            Button1.Caption:='&Start Scan';
          end; 
    7  :  begin
            ShowMessage('Please connect the device to USB port!');
            Button1.Caption:='&Start Scan';
          end;
    11 :  begin
            ShowMessage('Stop Scan!');
            Button1.Caption:='&Start Scan';
          end;
  end;
end;

end.
