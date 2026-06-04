import { Link } from "react-router-dom";
import Card from "../../ui/Card";
import TimelineIcon from "../../ui/TimelineIcon";
import { formatDate } from "./utils";

type Props = {
  timeline: Array<{
    id: string;
    type: string;
    text: string;
    alert_id?: string | null;
    actor_username?: string | null;
    created_at: string;
  }>;
  activityLimit: number;
};

export default function CaseActivityTab({ timeline, activityLimit }: Props) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-foreground">Activity</div>
          <div className="text-xs text-muted-foreground">Recent actions and case events</div>
        </div>

        <div className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {timeline.length}
        </div>
      </div>

      {timeline.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-8 text-center">
          <div className="text-sm font-medium text-foreground">No activity yet</div>
          <div className="mt-1 text-xs text-muted-foreground">Activity will appear here as the case evolves.</div>
        </div>
      ) : (
        <div className="max-h-[560px] space-y-3 overflow-auto pr-1">
          {timeline
            .slice()
            .reverse()
            .slice(0, activityLimit)
            .map((t) => (
              <div key={t.id} className="flex gap-3 rounded-2xl border border-border bg-background/60 p-3">
                <div className="pt-0.5">
                  <TimelineIcon type={t.type} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-6 text-foreground">
                    <span>{t.text}</span>
                    {t.alert_id ? (
                      <Link
                        to={`/alerts/${t.alert_id}`}
                        className="ml-1 text-sm font-medium text-foreground underline underline-offset-2"
                      >
                        ↗ alert
                      </Link>
                    ) : null}
                  </div>

                  <div className="mt-1 text-xs text-muted-foreground">
                    {t.actor_username ? `${t.actor_username} • ` : ""}
                    {formatDate(t.created_at)}
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </Card>
  );
}
