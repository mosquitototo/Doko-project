import MarkdownRenderedContent from "../ui/MarkdownRenderedContent";

type ChatMessageContentProps = {
  html: string;
};

const contentClassName = [
  "chat-message-content min-w-0 max-w-full overflow-x-auto text-sm leading-6 text-card-foreground",
  "[overflow-wrap:anywhere]",
].join(" ");

export default function ChatMessageContent({ html }: ChatMessageContentProps) {
  return (
    <div className={contentClassName}>
      <MarkdownRenderedContent markdown={html} />
    </div>
  );
}