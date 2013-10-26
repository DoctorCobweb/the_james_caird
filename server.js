/*
 *
 *
 * SHACKLETON SERVER - express app using mongoDB, redis for persistence layer.
 *
 * 
 */
//
//MODULE DEPENDENCIES:
var application_root = __dirname,
    express = require('express'),
    path = require('path'),
    format = require('util').format,
    fs = require('fs'),
    https = require('https'),
    express_validator = require('express-validator'),
    AWS = require('aws-sdk');



//setup AWS stuff
AWS.config.update({"accessKeyId": process.env.AWS_ACCESS_KEY_ID,
                   "secretAccessKey": process.env.AWS_SECRET_ACCESS_KEY,
                   "region": process.env.AWS_REGION});

console.log(process.env);


//The http server will listen to an appropriate port, or default to
//port 5001.
var port = process.env.PORT || 5001;
console.log('process.env.PORT: ' + process.env.PORT);


//create the express application. express() returns a Function designed to 
//be passed to nodes http/https servers as a callback to handle requests. 
var app = express();



//CONFIGURE SERVER:
app.configure(function () {
  app.use(express.bodyParser());
  app.use(express_validator());
  app.use(express.methodOverride());
  app.use(express.query());
  app.use(express.cookieParser('my secret string'));
  app.use(app.router);


  //express will use the first static path to foler it encounters. so when site_prod 
  //app.use call is uncommented it will use that & ignore site_dev static folder even 
  //when it is uncommented also (!)
  //uncomment this to use production, optimized, code from r.js process
  //app.use(express.static(path.join(application_root, 'site_prod')));

  //this sets the app to serve development code which is _not_ optimized 
  app.use(express.static(path.join(application_root, 'site_dev')));

  app.use(express.errorHandler({dumpExceptions: true, showStack: true}));
});



//a crude way of implementing the mobile pass route for iphone users
//app.get('/api/electronic_tickets/pkpass/:gig_id', pass.generate_pass(gig_id));
//require('./server-routes/pkpass')(mongoose, shackleton_conn, app);

/*
//a crude way of implementing the mobile pass route for android users
app.get('/api/electronic_tickets/google_wallet', function (req, res) {
 return res.end('in GET /api/electronic_tickets/google_wallet. not implemented yet!!!');
});
*/


//platying around with S3, creating buckets and filling them.
app.get('/api/test_apple_tickets/', function (req, res) {
  var s3 = new AWS.S3();
    s3.listBuckets(function(err, data) {
      for (var index in data.Buckets) {
        var bucket = data.Buckets[index];
        console.log("Bucket: ", bucket.Name, ' : ', bucket.CreationDate);
      }
  });

  s3.createBucket({Bucket: process.env.AWS_S3_BUCKET_APPLE}, function (err, data) {
    if (err) {
      console.log(err);
    } else {
      console.log(data);
      s3.putObject({
          Bucket: process.env.AWS_S3_BUCKET_APPLE,
          Key:    'fuckit',
          Body:    'yess'
        },
        function (err, data) {
          if (err) {
            console.log(err); 
          } else {
            console.log(data);
          }
      });
    }
  });
});
	





//Heroku: start production server. ssl endpoint is used for https so use standard
//http server

app.listen(port, function () {
 console.log('HTTP Express server listening on port %d in %s mode', 
   port, app.settings.env);
});
