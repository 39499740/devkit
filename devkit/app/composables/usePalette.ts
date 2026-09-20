export function usePalette() {
  const open = useState('devkit-palette-open', () => false)
  return {
    open,
    show: () => {
      open.value = true
    },
    hide: () => {
      open.value = false
    }
  }
}
