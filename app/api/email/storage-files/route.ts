import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

async function listAllFiles(service: ReturnType<typeof createServiceClient>, prefix: string): Promise<{ name: string; url: string }[]> {
  const { data: items } = await service.storage.from('crm-files').list(prefix, { limit: 100 })
  if (!items) return []

  const files: { name: string; url: string }[] = []

  for (const item of items) {
    if (item.id === null) {
      // It's a folder — recurse
      const sub = await listAllFiles(service, `${prefix}/${item.name}`)
      files.push(...sub)
    } else {
      const { data: urlData } = service.storage.from('crm-files').getPublicUrl(`${prefix}/${item.name}`)
      files.push({ name: item.name, url: urlData.publicUrl })
    }
  }

  return files
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const folder = req.nextUrl.searchParams.get('folder')
  if (!folder) return NextResponse.json({ error: 'folder required' }, { status: 400 })

  const service = createServiceClient()
  const files = await listAllFiles(service, folder)
  return NextResponse.json({ files })
}
