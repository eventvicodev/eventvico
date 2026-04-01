'use client'

import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { completeClientTaskActivity, createClientActivity, listClientActivities } from '@/lib/actions/clients'
import { clientActivityTypes, type CreateClientActivityInput } from '@/lib/schemas/clients'

type Activity = {
  id: string
  clientId: string
  activityType: 'call' | 'meeting' | 'note' | 'task'
  summary: string
  note: string | null
  dueAt: string | null
  taskStatus: 'open' | 'completed'
  completedAt: string | null
  createdAt: string
  loggedBy: {
    id: string
    name: string
  }
}

type Props = {
  clientId: string
}

function getInputClass(hasError: boolean) {
  return [
    'mt-2 h-11 w-full rounded-md border bg-white px-3 text-sm text-neutral-900 transition',
    'placeholder:text-neutral-400',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
    hasError ? 'border-red-500' : 'border-neutral-300',
  ].join(' ')
}

function formatWhen(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function ClientActivities({ clientId }: Props) {
  const { addToast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [activities, setActivities] = useState<Activity[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)

  const {
    register,
    handleSubmit,
    setError,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateClientActivityInput>({
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: {
      clientId,
      activityType: 'call',
      summary: '',
      note: '',
      dueAt: '',
    },
  })

  const selectedType = watch('activityType')

  const loadActivities = async () => {
    setIsLoading(true)
    const result = await listClientActivities(clientId)
    setIsLoading(false)

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }
    setActivities(result.data.activities)
  }

  useEffect(() => {
    void loadActivities()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const openTasks = useMemo(
    () => activities.filter((item) => item.activityType === 'task' && item.taskStatus === 'open').length,
    [activities]
  )

  const onSubmit = async (values: CreateClientActivityInput) => {
    const result = await createClientActivity({
      ...values,
      clientId,
    })

    if (!result.success) {
      if (result.error.fields) {
        Object.entries(result.error.fields).forEach(([fieldName, messages]) => {
          if (messages && messages.length > 0) {
            setError(fieldName as keyof CreateClientActivityInput, {
              type: 'server',
              message: messages[0],
            })
          }
        })
      } else {
        addToast('error', result.error.message)
      }
      return
    }

    reset({
      clientId,
      activityType: 'call',
      summary: '',
      note: '',
      dueAt: '',
    })
    setDialogOpen(false)
    await loadActivities()
  }

  const handleCompleteTask = async (activityId: string) => {
    const previous = activities
    setActivities((current) =>
      current.map((item) =>
        item.id === activityId
          ? { ...item, taskStatus: 'completed', completedAt: new Date().toISOString() }
          : item
      )
    )

    const result = await completeClientTaskActivity(activityId)
    if (!result.success) {
      setActivities(previous)
      addToast('error', 'Update failed — changes reverted')
      return
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Activity timeline</h2>
          <p className="mt-1 text-sm text-neutral-600">
            {openTasks > 0 ? `${openTasks} open task(s)` : 'All tasks are up to date'}
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button type="button">Log activity</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log activity</DialogTitle>
              <DialogDescription>
                Capture calls, meetings, notes, and tasks for this client.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
              <div>
                <label htmlFor="activityType" className="text-sm font-medium text-neutral-800">Type</label>
                <select
                  id="activityType"
                  className={getInputClass(Boolean(errors.activityType))}
                  {...register('activityType')}
                >
                  {clientActivityTypes.map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
                {errors.activityType?.message ? <p className="mt-1 text-xs text-red-600">{errors.activityType.message}</p> : null}
              </div>

              <div>
                <label htmlFor="summary" className="text-sm font-medium text-neutral-800">Summary</label>
                <input id="summary" type="text" className={getInputClass(Boolean(errors.summary))} {...register('summary')} />
                {errors.summary?.message ? <p className="mt-1 text-xs text-red-600">{errors.summary.message}</p> : null}
              </div>

              <div>
                <label htmlFor="note" className="text-sm font-medium text-neutral-800">Notes</label>
                <textarea
                  id="note"
                  className="mt-2 min-h-24 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                  {...register('note')}
                />
                {errors.note?.message ? <p className="mt-1 text-xs text-red-600">{errors.note.message}</p> : null}
              </div>

              {selectedType === 'task' ? (
                <div>
                  <label htmlFor="dueAt" className="text-sm font-medium text-neutral-800">Due date/time</label>
                  <input id="dueAt" type="datetime-local" className={getInputClass(Boolean(errors.dueAt))} {...register('dueAt')} />
                  {errors.dueAt?.message ? <p className="mt-1 text-xs text-red-600">{errors.dueAt.message}</p> : null}
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save activity'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : activities.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">
          No activity logged yet. Add your first call, meeting, note, or task.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {activities.map((activity) => (
            <li key={activity.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-neutral-900">
                    {activity.summary}
                  </p>
                  <p className="mt-1 text-xs text-neutral-600">
                    {activity.activityType.toUpperCase()} · {formatWhen(activity.createdAt)} · {activity.loggedBy.name}
                  </p>
                </div>
                {activity.activityType === 'task' ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs ${activity.taskStatus === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {activity.taskStatus}
                  </span>
                ) : null}
              </div>

              {activity.note ? <p className="mt-2 text-sm text-neutral-700">{activity.note}</p> : null}
              {activity.dueAt ? (
                <p className="mt-2 text-xs text-neutral-600">
                  Due: {formatWhen(activity.dueAt)}
                </p>
              ) : null}

              {activity.activityType === 'task' && activity.taskStatus === 'open' ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => {
                    void handleCompleteTask(activity.id)
                  }}
                >
                  Mark complete
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

