using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Speech.Synthesis;
using System.Speech.AudioFormat;

// Events are collected in C# so asynchronous SAPI callbacks never depend on a
// PowerShell runspace. All offsets describe the generated audio, in milliseconds.
public sealed class VoiceWord {
    public string text;
    public double time;
}
public sealed class VoiceMouth {
    public int id;
    public double time;
    public double duration;
}
public sealed class VoiceResult {
    public string audioContent;
    public string voice;
    public VoiceWord[] words;
    public VoiceMouth[] mouths;
}
public sealed class WindowsVoice : IDisposable {
    private readonly SpeechSynthesizer synth = new SpeechSynthesizer();
    private readonly List<VoiceWord> words = new List<VoiceWord>();
    private readonly List<VoiceMouth> mouths = new List<VoiceMouth>();
    public string Name { get { return synth.Voice.Name; } }

    public WindowsVoice() {
        var voices = synth.GetInstalledVoices().Where(v => v.Enabled && v.VoiceInfo.Culture.Name == "en-US").ToArray();
        var chosen = voices.FirstOrDefault(v => v.VoiceInfo.Gender == VoiceGender.Female) ?? voices.FirstOrDefault();
        if (chosen == null) throw new InvalidOperationException("Install an English (US) Windows speech voice to enable local speech.");
        synth.SelectVoice(chosen.VoiceInfo.Name);
        synth.SpeakProgress += (s, e) => {
            lock (words) words.Add(new VoiceWord { text = e.Text, time = e.AudioPosition.TotalMilliseconds });
        };
        synth.VisemeReached += (s, e) => {
            lock (mouths) mouths.Add(new VoiceMouth { id = e.Viseme, time = e.AudioPosition.TotalMilliseconds, duration = e.Duration.TotalMilliseconds });
        };
    }
    public VoiceResult Render(string text, double rate) {
        words.Clear(); mouths.Clear();
        synth.Rate = Math.Max(-4, Math.Min(4, (int)Math.Round(Math.Log(rate) / Math.Log(1.1))));
        using (var stream = new MemoryStream()) {
            // Fix the output format explicitly: SAPI AudioPosition uses this
            // stream's sample clock, including any resampling by Windows.
            synth.SetOutputToAudioStream(stream, new SpeechAudioFormatInfo(16000, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
            synth.Speak(text);
            synth.SetOutputToNull();
            var pcm = stream.ToArray();
            byte[] wave;
            using (var container = new MemoryStream()) {
                using (var writer = new BinaryWriter(container)) {
                    writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + pcm.Length);
                    writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16);
                    writer.Write((short)1); writer.Write((short)1); writer.Write(16000); writer.Write(32000);
                    writer.Write((short)2); writer.Write((short)16);
                    writer.Write(System.Text.Encoding.ASCII.GetBytes("data")); writer.Write(pcm.Length); writer.Write(pcm);
                    wave = container.ToArray();
                }
            }
            return new VoiceResult {
                audioContent = Convert.ToBase64String(wave), voice = Name,
                words = words.ToArray(), mouths = mouths.ToArray()
            };
        }
    }
    public void Dispose() { synth.Dispose(); }
}
