const express = require('express')
const request = require('request')
const querystring = require('querystring')
const body_parser = require('body-parser')

let app = express()
app.use(body_parser.urlencoded({extended: false}))
app.use(body_parser.json())

let redirect_uri = 
  process.env.REDIRECT_URI || 
  'https://mod3backend.herokuapp.com/callback'

app.get('/login', function(req, res) {
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: process.env.SPOTIFY_CLIENT_ID,
      scope: 'user-read-private user-read-email user-modify-playback-state app-remote-control streaming', // this is where I need to add more permissions!
      redirect_uri
    }))
})

app.get('/callback', function(req, res) {
  let code = req.query.code || null
  let authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: code,
      redirect_uri,
      grant_type: 'authorization_code'
    },
    headers: {
      'Authorization': 'Basic ' + (Buffer.from(
        process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
      ).toString('base64'))
    },
    json: true
  }
  request.post(authOptions, function(error, response, body) {
    var access_token = body.access_token
    let uri = process.env.FRONTEND_URI || 'https://mod3frontend.herokuapp.com/'
    res.redirect(uri + '?access_token=' + access_token)
  })
})


var venues = []
var connectCodeCounter = 0

let getVenue = (connectCode) => {
  for(i=0; i<venues.length; i++) {
    if(venues[i].connectCode == connectCode) {
      return venues[i]
    }
  }
}

app.get('/create', function(req, res) {
  let newConnectCode = connectCodeCounter.toString() + Math.random().toString().slice(2, 6)
  venues.push({
    "connectCode" : newConnectCode, // add a speacial code just for the host?
    "name" : req.body.name,
    "queue" : []
  })
  res.send({newConnectCode})
  connectCodeCounter += 1
  console.log(venues)
})

app.get('/join', function(req, res) {
  let venue = getVenue(req.body.connectCode)
  res.send(venue ? "Connected to: " + venue.name : "Could not connect")
})

app.get('/vote', function(req, res) { // TODO: use "post"
  let queue = getVenue(req.body.connectCode).queue
  // check if the song is already in the playlist
  let alreadyInQueue = false
  for(i=0; i<queue.length; i++) {
    if(queue[i].url == req.body.songUrl) {
      queue[i].numVotes++ // TODO: prevent one user from voting multiple times
      alreadyInQueue = true
    }
  }
  if(!alreadyInQueue) {
    queue.push({
      "url" : req.body.songUrl,
      "numVotes" : 0
    })
  }
  res.sendStatus(200)
})

app.get('/queue', function(req, res) {
  res.send(getVenue(req.body.connectCode).queue)
})

let port = process.env.PORT || 8888
console.log(`Listening on port ${port}. Go /login to initiate authentication flow.`)
app.listen(port)