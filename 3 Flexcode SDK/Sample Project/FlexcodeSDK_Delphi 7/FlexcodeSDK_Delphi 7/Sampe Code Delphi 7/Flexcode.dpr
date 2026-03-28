program Flexcode;

uses
  Forms,
  unitRegistration in 'unitRegistration.pas' {FormRegistration},
  unitMain in 'unitMain.pas' {FormMain},
  UnitIdentification in 'UnitIdentification.pas' {FormIdentification},
  unitCaptureImage in 'unitCaptureImage.pas' {FormCaptureImage};

{$R *.res}

begin
  Application.Initialize;
  Application.CreateForm(TFormMain, FormMain);
  Application.CreateForm(TFormRegistration, FormRegistration);
  Application.CreateForm(TFormIdentification, FormIdentification);
  Application.CreateForm(TFormCaptureImage, FormCaptureImage);
  Application.Run;
end.
