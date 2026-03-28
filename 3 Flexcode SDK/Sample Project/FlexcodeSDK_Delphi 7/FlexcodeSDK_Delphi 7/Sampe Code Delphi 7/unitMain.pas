unit unitMain;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, jpeg, ExtCtrls, StdCtrls;

type
  TFormMain = class(TForm)
    Button1: TButton;
    Button2: TButton;
    Button3: TButton;
    procedure Button1Click(Sender: TObject);
    procedure Button2Click(Sender: TObject);
    procedure Button3Click(Sender: TObject);
  private
    { Private declarations }
  public
    { Public declarations }
  end;

var
  FormMain: TFormMain;

implementation

uses unitRegistration, UnitIdentification, unitCaptureImage;

{$R *.dfm}

procedure TFormMain.Button1Click(Sender: TObject);
begin
  FormRegistration.ShowModal;
end;



procedure TFormMain.Button2Click(Sender: TObject);
begin
  FormIdentification.ShowModal;
end;

procedure TFormMain.Button3Click(Sender: TObject);
begin
  FormCaptureImage.ShowModal();
end;

end.
