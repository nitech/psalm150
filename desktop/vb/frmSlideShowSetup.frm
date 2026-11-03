VERSION 5.00
Object = "{831FDD16-0C5C-11D2-A9FC-0000F8754DA1}#2.0#0"; "C:\Program Files (x86)\VBReFormer\Lib\MSCOMCTL.OCX"
Object = "{3BD5B3F5-4573-4A18-AFA1-96A32F6C872F}#1.2#0"; "C:\WINDOWS\SysWow64\ExPropList30.ocx"
Object = "{54FC599E-9611-11D2-8350-E97AACC90D73}#1.1#0"; "C:\WINDOWS\SysWow64\SpltrBar.ocx"

Begin VB.Form frmSlideShowSetup
    Caption = "Slide Show Setup"
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    BorderStyle = 3
    Icon = frmSlideShowSetup.frx:0000
    LinkTopic = "Form2"
    MaxButton = 0              'False
    MinButton = 0              'False
    ClientLeft   = 4380
    ClientTop    = 5385
    ClientWidth  = 11160
    ClientHeight = 5235
    StartupPosition = 1
    PaletteMode = 1
    Begin MSComctlLib.ImageList imgList
        OleObjectBlob = frmSlideShowSetup.frx:031E
        Left = 4920
        Top = 4560
    End
    Begin VB.CommandButton cmdRestoreDefaults
        Caption = "Restore Defaults..."
        Left   = 2700
        Top    = 4710
        Width  = 1800
        Height = 315
        TabIndex = 5
    End
    Begin VB.CommandButton cmdSaveAsDefault
        Caption = "Save As Defaults..."
        Left   = 930
        Top    = 4710
        Width  = 1620
        Height = 315
        TabIndex = 4
    End
    Begin ExPropList30.PropertyList prpList
        Left   = 120
        Top    = 210
        Width  = 5055
        Height = 4035
        TabIndex = 0
        OleObjectBlob = frmSlideShowSetup.frx:031E
    End
    Begin VB.Frame Frame1
        Caption = "Preview"
        Left   = 5430
        Top    = 150
        Width  = 5400
        Height = 4320
        TabIndex = 6
        Begin VB.PictureBox picPreview
            BackColor = -2147483643
            ForeColor = -2147483640
            Left   = 180
            Top    = 300
            Width  = 4830
            Height = 3630
            TabIndex = 7
            ScaleMode = 3
            AutoRedraw = 0              'False
            FontTransparent = -1              'True
            TabStop = 0              'False
            Appearance = 0
            Begin VSB_V1.VSBShow VSBShow1
                Left   = 60
                Top    = 75
                Width  = 4635
                Height = 3435
                OleObjectBlob = frmSlideShowSetup.frx:031E
            End
        End
        Begin SplitterBars.VSplitterBar vsbLeftMargin
            Left   = 180
            Top    = 300
            Width  = 75
            Height = 3585
            Visible = 0              'False
            OleObjectBlob = frmSlideShowSetup.frx:031E
        End
        Begin SplitterBars.HSplitterBar hsbTopMargin
            Left   = 1200
            Top    = 210
            Width  = 3735
            Height = 30
            Visible = 0              'False
            OleObjectBlob = frmSlideShowSetup.frx:031E
        End
        Begin SplitterBars.VSplitterBar vsbRightMargin
            Left   = 3840
            Top    = 180
            Width  = 75
            Height = 3855
            Visible = 0              'False
            OleObjectBlob = frmSlideShowSetup.frx:031E
        End
        Begin SplitterBars.HSplitterBar hsbBottomMargin
            Left   = 0
            Top    = 3510
            Width  = 3735
            Height = 30
            Visible = 0              'False
            OleObjectBlob = frmSlideShowSetup.frx:031E
        End
        Begin VB.Image imgLeftMargin
            Left   = 210
            Top    = 4020
            Width  = 135
            Height = 120
            Visible = 0              'False
        End
        Begin VB.Image imgRightMargin
            Picture = frmSlideShowSetup.frx:031E
            Left   = 4890
            Top    = 4020
            Width  = 135
            Height = 120
            Visible = 0              'False
            Appearance = 0
        End
        Begin VB.Image imgTopMargin
            Picture = frmSlideShowSetup.frx:07D4
            Left   = 5190
            Top    = 300
            Width  = 120
            Height = 135
            Visible = 0              'False
        End
        Begin VB.Image imgBottomMargin
            Picture = frmSlideShowSetup.frx:0C72
            Left   = 5040
            Top    = 3750
            Width  = 120
            Height = 135
            Visible = 0              'False
        End
    End
    Begin VB.CommandButton cmdOK
        Caption = "OK"
        Left   = 6195
        Top    = 4695
        Width  = 1140
        Height = 315
        TabIndex = 1
    End
    Begin VB.CommandButton cmdApply
        Caption = "Apply"
        Left   = 8760
        Top    = 4695
        Width  = 1140
        Height = 315
        TabIndex = 3
    End
    Begin VB.CommandButton cmdCancel
        Caption = "Cancel"
        Left   = 7500
        Top    = 4695
        Width  = 1140
        Height = 315
        TabIndex = 2
        Cancel = -1              'True
    End
End
