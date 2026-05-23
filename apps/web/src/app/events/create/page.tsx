import CreateEventWizard from '@/components/events/create/CreateEventWizard'

export default function CreateEventPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>
}) {
  return <CreateEventWizard searchParams={searchParams} />
}
