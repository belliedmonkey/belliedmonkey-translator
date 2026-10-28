"""Mac offline video subtitles. One entry: extract_to_wav then transcribe_wav."""

__all__ = ["main"]


def main(argv=None):
    from offline_video_asr.cli import main as cli_main
    return cli_main(argv)
