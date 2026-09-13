type Props = {
  html: string;
  className?: string;
};

export default function TiptapRenderedContent(props: Props) {
  return (
    <div
      className={[
        "tiptap-rendered-content min-h-0 min-w-0 break-words text-sm text-foreground",
        props.className || "",
      ].join(" ")}
    >
      <div className="tiptap-editor min-h-0 whitespace-pre-wrap break-words px-0 py-0 text-sm text-foreground [overflow-wrap:anywhere]">
        {props.html || ""}
      </div>
    </div>
  );
}
