import * as Icons from 'lucide-react'
import type { ComponentProps, ComponentType } from 'react'

export function IconPlaceholder({lucide,tabler,hugeicons,phosphor,remixicon,...props}: ComponentProps<'svg'> & {lucide?:string;tabler?:string;hugeicons?:string;phosphor?:string;remixicon?:string}) {
  const name=lucide?.replace(/Icon$/,'')||'Circle'
  const Icon=(Icons as unknown as Record<string,ComponentType<ComponentProps<'svg'>>>)[name]||Icons.Circle
  return <Icon {...props}/>
}
