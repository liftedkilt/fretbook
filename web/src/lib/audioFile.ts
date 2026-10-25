/** Whether a dropped file is a recording the transcriber can read. Browsers often leave `type` empty, so the name counts too. */
const AUDIO_EXTENSION = /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|aif|aiff|wma|weba)$/i;

export function isAudioFile(file: Pick<File, "name" | "type">): boolean {
  return file.type.startsWith("audio/") || AUDIO_EXTENSION.test(file.name);
}
