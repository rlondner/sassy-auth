import { readFileAsDataUri } from '../read-file-as-data-uri'

describe('readFileAsDataUri', () => {
  it('resolves with a data URI for the file contents', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    const result = await readFileAsDataUri(file)
    expect(result).toMatch(/^data:text\/plain;base64,/)
    expect(result).toContain(Buffer.from('hello').toString('base64'))
  })
})
